const express = require('express');
const axios = require('axios');
const srtParser2 = require('srt-parser-2').default;

const app = express();
const parser = new srtParser2();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.stremio.sr.translator.fixed',
    version: '3.1.0',
    name: 'Serbian Realtime Translator',
    description: 'Сигурен и бесплатен превод на српска латиница.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: []
};

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;

    const subtitles = [{
        id: `sr-fixed-${id}`,
        url: `https://${req.get('host')}/translate-sub/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (Auto-Latin)'
    }];

    res.json({ subtitles });
});

// Бесплатна функција за превод со енкодирање на поединечни линии
async function translateLine(text) {
    if (!text || text.trim() === '') return '';
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=sr&dt=t&q=${encodeURIComponent(text)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 3000
        });
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
        return text;
    } catch (err) {
        return text; // Доколку има тајмаут или грешка, го враќаме англискиот текст за да има титл
    }
}

app.get('/translate-sub/:type/:id.vtt', async (req, res) => {
    const { type, id } = req.params;

    try {
        // 1. Извлекување на англиски титл
        const subSearchUrl = `https://v3-cinemeta.strem.fun/subtitles/${type}/${id}.json`;
        const subRes = await axios.get(subSearchUrl).catch(() => null);

        let englishSubUrl = null;
        if (subRes && subRes.data && subRes.data.subtitles) {
            const en = subRes.data.subtitles.find(s => s.lang === 'eng' || s.lang === 'en');
            if (en) englishSubUrl = en.url;
        }

        if (!englishSubUrl) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nНе е пронајден англиски титл за превод.");
        }

        // 2. Преземање на фајлот
        const rawSub = await axios.get(englishSubUrl, { responseType: 'text' });
        let parsed = [];

        if (rawSub.data.includes('-->')) {
            // Анализа на SRT/VTT содржината
            const cleanSrt = rawSub.data.replace(/WEBVTT/g, '').trim();
            parsed = parser.fromSrt(cleanSrt);
        }

        if (!parsed || parsed.length === 0) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при читање на формата на титлот.");
        }

        // 3. Преведување во паралелни мали пакети за брзина (без да не блокира Google)
        let vttOutput = "WEBVTT\n\n";
        const limit = Math.min(parsed.length, 500); // Преведуваме до 500 главни реплики брзо

        // Бачирање по 10 реплики паралелно
        for (let i = 0; i < limit; i += 10) {
            const chunk = parsed.slice(i, i + 10);
            const translations = await Promise.all(chunk.map(item => translateLine(item.text)));

            chunk.forEach((item, index) => {
                const startTime = item.startTime.replace(',', '.');
                const endTime = item.endTime.replace(',', '.');
                const translatedText = translations[index] || item.text;

                vttOutput += `${i + index + 1}\n${startTime} --> ${endTime}\n${translatedText}\n\n`;
            });
        }

        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send(vttOutput);

    } catch (error) {
        console.error("Error generating sub:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка на серверот.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
