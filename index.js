const express = require('express');
const axios = require('axios');

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.stremio.sr.realtime.translator',
    version: '2.0.0',
    name: 'Serbian Realtime Subtitle Translator',
    description: 'Брз авто-превод на англиски титлови на српска латиница во реално време.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: []
};

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// 1. Нудиме српски титл за секој филм/серија
app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;

    const subtitles = [{
        id: `sr-realtime-${id}`,
        url: `https://${req.get('host')}/translate-sub/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (Auto-Latin)'
    }];

    res.json({ subtitles });
});

// Функција за брз превод преку Google Translate Web API
async function translateChunk(text) {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=sr&dt=t&q=${encodeURIComponent(text)}`;
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
        return text;
    } catch (err) {
        return text; // Доколку има проблем со линијата, го враќаме оригиналот за да не падне плејерот
    }
}

// 2. Влечење на англискиот титл од Stremio OpenSubtitles и преведување
app.get('/translate-sub/:type/:id.vtt', async (req, res) => {
    const { type, id } = req.params;

    try {
        // Извлекуваме англиски титл директно од главниот Stremio Subtitle Service (Cinemeta / OpenSubtitles)
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

        // Преземање на англискиот VTT / SRT фајл
        const rawSub = await axios.get(englishSubUrl, { responseType: 'text' });
        const lines = rawSub.data.split(/\r?\n/);

        let translatedVtt = "WEBVTT\n\n";
        let textBatch = [];
        let timeBuffer = [];

        // Паметно процесирање линија по линија
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();

            if (line.includes('-->')) {
                // Стандардизација на временски ознаки за VTT
                timeBuffer.push(line.replace(',', '.'));
            } else if (line.length > 0 && !line.startsWith('WEBVTT') && isNaN(line)) {
                textBatch.push(line);
            } else if (line === '' && textBatch.length > 0) {
                // Имаме собрано еден блок текст - го преведуваме
                const originalText = textBatch.join(' ');
                const translatedText = await translateChunk(originalText);

                if (timeBuffer.length > 0) {
                    translatedVtt += `${timeBuffer[0]}\n${translatedText}\n\n`;
                }

                textBatch = [];
                timeBuffer = [];
            }
        }

        // Завршен превод за последниот блок
        if (textBatch.length > 0 && timeBuffer.length > 0) {
            const originalText = textBatch.join(' ');
            const translatedText = await translateChunk(originalText);
            translatedVtt += `${timeBuffer[0]}\n${translatedText}\n\n`;
        }

        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send(translatedVtt);

    } catch (error) {
        console.error("Translation Error:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при авто-преводот.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
