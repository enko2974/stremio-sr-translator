const express = require('express');
const axios = require('axios');

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.stremio.sr.fast.free.translator',
    version: '3.0.0',
    name: 'Serbian Fast Free Translator',
    description: '100% Бесплатен и ултра-брз превод на српска латиница.',
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
        id: `sr-free-${id}`,
        url: `https://${req.get('host')}/translate-sub/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (Fast Free Auto-Latin)'
    }];

    res.json({ subtitles });
});

// Функција за брз групен превод (Batch processing)
async function translateBatch(textArray) {
    try {
        // Ги спојуваме сите линии со специјален сепаратор " ||| " за да ги преведеме сите со едно барање
        const combinedText = textArray.join(' ||| ');
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=sr&dt=t&q=${encodeURIComponent(combinedText)}`;
        
        const response = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        if (response.data && response.data[0]) {
            const fullTranslated = response.data[0].map(item => item[0]).join('');
            return fullTranslated.split(/\s*\|\|\|\s*/);
        }
        return textArray;
    } catch (err) {
        console.error('Batch translation error:', err.message);
        return textArray;
    }
}

// 2. Влечење на англискиот титл и експресен превод
app.get('/translate-sub/:type/:id.vtt', async (req, res) => {
    const { type, id } = req.params;

    try {
        // Одиме до официјалниот Stremio субтитл сервис за да го земеме англискиот VTT/SRT
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

        // Преземање на англискиот титл
        const rawSub = await axios.get(englishSubUrl, { responseType: 'text' });
        const lines = rawSub.data.split(/\r?\n/);

        let blocks = [];
        let currentTimes = '';
        let currentText = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (line.includes('-->')) {
                currentTimes = line.replace(',', '.');
            } else if (line.length > 0 && !line.startsWith('WEBVTT') && isNaN(line)) {
                currentText.push(line);
            } else if (line === '' && currentTimes && currentText.length > 0) {
                blocks.push({ time: currentTimes, text: currentText.join(' ') });
                currentTimes = '';
                currentText = [];
            }
        }
        if (currentTimes && currentText.length > 0) {
            blocks.push({ time: currentTimes, text: currentText.join(' ') });
        }

        // Делиме на групи од по 40 реплики за моментален превод
        const chunkSize = 40;
        let vttOutput = "WEBVTT\n\n";

        for (let i = 0; i < blocks.length; i += chunkSize) {
            const chunk = blocks.slice(i, i + chunkSize);
            const textsToTranslate = chunk.map(b => b.text);
            
            const translatedTexts = await translateBatch(textsToTranslate);

            chunk.forEach((b, index) => {
                const translated = translatedTexts[index] || b.text;
                vttOutput += `${b.time}\n${translated}\n\n`;
            });
        }

        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send(vttOutput);

    } catch (error) {
        console.error("Error generating sub:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при брзиот превод.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
