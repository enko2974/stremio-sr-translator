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
    id: 'org.stremio.sr.opensub.translator',
    version: '3.2.0',
    name: 'Serbian Realtime Translator (OpenSubtitles)',
    description: 'Влече англиски титлови од OpenSubtitles и ги преведува на српска латиница.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: []
};

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// 1. Нудиме опција за српски титл во Stremio/Nuvio
app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;

    const subtitles = [{
        id: `sr-opensub-${id}`,
        url: `https://${req.get('host')}/translate-sub/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (Auto-Latin)'
    }];

    res.json({ subtitles });
});

// Брза функција за преведување преку Google Translate API
async function translateLine(text) {
    if (!text || text.trim() === '') return '';
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=sr&dt=t&q=${encodeURIComponent(text)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            timeout: 4000
        });
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
        return text;
    } catch (err) {
        return text; // Ако има проблем со мрежата, врати го оригиналот
    }
}

// 2. Преземање титл од OpenSubtitles V3 API и преведување
app.get('/translate-sub/:type/:id.vtt', async (req, res) => {
    const { type, id } = req.params;

    try {
        // Официјален OpenSubtitles v3 адон ендпоинт за Stremio
        const openSubUrl = `https://opensubtitles.strem.fun/subtitles/${type}/${id}.json`;
        const openSubRes = await axios.get(openSubUrl).catch(() => null);

        let englishSubUrl = null;

        if (openSubRes && openSubRes.data && openSubRes.data.subtitles) {
            // Наоѓаме англиски титл (eng / en)
            const enSub = openSubRes.data.subtitles.find(s => s.lang === 'eng' || s.lang === 'en');
            if (enSub) {
                englishSubUrl = enSub.url;
            }
        }

        // Доколку OpenSubtitles v3 нема, пробај преку заменскиот OpenSubtitles v2 mirror
        if (!englishSubUrl) {
            const fallbackUrl = `https://opensubtitles-v2.strem.fun/subtitles/${type}/${id}.json`;
            const fbRes = await axios.get(fallbackUrl).catch(() => null);
            if (fbRes && fbRes.data && fbRes.data.subtitles) {
                const enSub = fbRes.data.subtitles.find(s => s.lang === 'eng' || s.lang === 'en');
                if (enSub) englishSubUrl = enSub.url;
            }
        }

        if (!englishSubUrl) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nНе е пронајден англиски титл на OpenSubtitles.");
        }

        // Преземање на англискиот титл фајл
        const rawSub = await axios.get(englishSubUrl, { responseType: 'text' });
        
        // Читање на SRT / VTT содржината
        let parsed = [];
        const cleanText = rawSub.data.replace(/^WEBVTT/i, '').trim();
        parsed = parser.fromSrt(cleanText);

        if (!parsed || parsed.length === 0) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при обработка на OpenSubtitles фајлот.");
        }

        // Генерирање преведен VTT
        let vttOutput = "WEBVTT\n\n";
        
        // Обработуваме во брзи паралелни групи (по 10 реплики одеднаш)
        const totalLines = Math.min(parsed.length, 600); // Ограничување за максимална брзина
        
        for (let i = 0; i < totalLines; i += 10) {
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
        console.error("Грешка:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при поврзување со OpenSubtitles.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
