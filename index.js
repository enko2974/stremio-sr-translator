const express = require('express');
const axios = require('axios');
const srtParser2 = require('srt-parser-2').default;
const { translate } = require('@vitalets/google-translate-api');

const app = express();
const parser = new srtParser2();

// Овозможи CORS за сите Stremio и Nuvio апликации
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

// 1. Manifest
const manifest = {
    id: 'org.stremio.sr.translator',
    version: '1.0.0',
    name: 'Auto SR-Latin Subtitles',
    description: 'Брз превод на англиски титлови на српски (латиница).',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: []
};

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// 2. Endpoint за листање титлови
app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;

    const subtitles = [{
        id: `sr-lat-${id}`,
        url: `https://${req.get('host')}/translate-sub/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (Auto-Latin)'
    }];

    res.json({ subtitles });
});

// 3. Динамичка обработка и превод
app.get('/translate-sub/:type/:id.vtt', async (req, res) => {
    try {
        // Пример тест срт (овде во иднина може да поврзеш API за точен OpenSubtitles линк)
        const sampleSrtUrl = 'https://raw.githubusercontent.com/andreasbm/vtt-to-srt/master/test/test.srt'; 
        const srtResponse = await axios.get(sampleSrtUrl);
        const parsedSrt = parser.fromSrt(srtResponse.data);

        // Групен превод за максимална брзина
        const textToTranslate = parsedSrt.map(item => item.text).join(' \n--- \n');
        
        const translationRes = await translate(textToTranslate, { to: 'sr' });
        const translatedLines = translationRes.text.split(' \n--- \n');
        
        let vttOutput = "WEBVTT\n\n";
        parsedSrt.forEach((item, index) => {
            const translatedText = translatedLines[index] || item.text;
            vttOutput += `${index + 1}\n`;
            vttOutput += `${item.startTime.replace(',', '.')} --> ${item.endTime.replace(',', '.')}\n`;
            vttOutput += `${translatedText}\n\n`;
        });

        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send(vttOutput);

    } catch (error) {
        console.error("Грешка при превод:", error.message);
        res.status(500).send("Грешка при превод.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
