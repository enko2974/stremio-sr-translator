const express = require('express');
const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();

// Иницијализација на Gemini SDK
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.stremio.sr.gemini.translator',
    version: '5.1.0',
    name: 'Serbian AI Translator (Gemini)',
    description: 'Ултра-прецизен и брз превод на српска латиница со Gemini AI.',
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
        id: `sr-gemini-${id}`,
        url: `https://${req.get('host')}/translate-sub/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (Gemini AI Auto-Latin)'
    }];

    res.json({ subtitles });
});

// AI Превод преку Gemini
async function translateWithGemini(textChunk) {
    if (!process.env.GEMINI_API_KEY) {
        console.error("ГРЕШКА: GEMINI_API_KEY не е поставен во Render!");
        return textChunk;
    }

    try {
        const prompt = `You are an expert subtitle translator. Translate the following movie subtitle text from English to Serbian using Latin script (Serbian Latin).
CRITICAL RULES:
1. Do NOT modify timestamps (e.g. 00:01:20.000 --> 00:01:23.000), line numbers, or VTT header formatting.
2. Translate ONLY the actual speech/text lines.
3. Keep the exact line structure and line count.

Text to translate:
${textChunk}`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        return responseText || textChunk;
    } catch (err) {
        console.error("Gemini AI Translation Error:", err.message);
        return textChunk;
    }
}

app.get('/translate-sub/:type/:id.vtt', async (req, res) => {
    const { type, id } = req.params;

    try {
        const sources = [
            `https://v3-cinemeta.strem.fun/subtitles/${type}/${id}.json`,
            `https://opensubtitles-v2.strem.fun/subtitles/${type}/${id}.json`
        ];

        let englishSubUrl = null;
        for (const srcUrl of sources) {
            const response = await axios.get(srcUrl, { timeout: 4000 }).catch(() => null);
            if (response && response.data && response.data.subtitles) {
                const enSub = response.data.subtitles.find(s => s.lang === 'eng' || s.lang === 'en');
                if (enSub && enSub.url) {
                    englishSubUrl = enSub.url;
                    break;
                }
            }
        }

        if (!englishSubUrl) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nНе е пронајден англиски титл.");
        }

        const rawSubRes = await axios.get(englishSubUrl, { responseType: 'text', timeout: 6000 });
        let rawText = rawSubRes.data;

        if (!rawText.startsWith('WEBVTT')) {
            rawText = "WEBVTT\n\n" + rawText;
        }

        // Преведуваме во блокови од 100 линии за брзина и прецизност
        const lines = rawText.split(/\r?\n/);
        let blocks = [];
        let tempBlock = [];

        for (let line of lines) {
            tempBlock.push(line);
            if (tempBlock.length >= 100) {
                blocks.push(tempBlock.join('\n'));
                tempBlock = [];
            }
        }
        if (tempBlock.length > 0) blocks.push(tempBlock.join('\n'));

        let finalTranslatedVtt = "";
        for (let block of blocks) {
            const translatedBlock = await translateWithGemini(block);
            finalTranslatedVtt += translatedBlock + "\n";
        }

        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send(finalTranslatedVtt);

    } catch (error) {
        console.error("Main Error:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка на серверот.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
