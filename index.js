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

// Функција за брз превод преку Google Translate API
async function translateText(text, targetLang = 'sr') {
    try {
        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await axios.get(url);
        if (response.data && response.data[0]) {
            return response.data[0].map(item => item[0]).join('');
        }
        return text;
    } catch (err) {
        console.error('Translation Error:', err.message);
        return text;
    }
}

// 1. Понуди го опцијата за титл во Stremio
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

// 2. Преземање на точниот англиски титл и преведување
app.get('/translate-sub/:type/:id.vtt', async (req, res) => {
    const { type, id } = req.params;

    try {
        // Овде извлекуваме јавен OpenSubtitles VTT/SRT титл базиран на IMDb ID (ttXXXXXXX)
        // Користиме јавен OpenSubtitles mirror за соодветниот филм/серија
        const cleanId = id.split(':')[0]; // Го земаме главниот IMDb ID
        const subSourceUrl = `https://v3-cinemeta.strem.fun/subtitles/${type}/${id}.json`;
        
        const subSearchRes = await axios.get(subSourceUrl).catch(() => null);
        let targetSubUrl = null;

        if (subSearchRes && subSearchRes.data && subSearchRes.data.subtitles) {
            const enSub = subSearchRes.data.subtitles.find(s => s.lang === 'eng' || s.lang === 'en');
            if (enSub) targetSubUrl = enSub.url;
        }

        // Ако не најде директен титл, врати празен VTT за да не закочи плејерот
        if (!targetSubUrl) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nНе е најден англиски титл за превод.");
        }

        const srtResponse = await axios.get(targetSubUrl);
        let parsedSrt = [];

        if (targetSubUrl.endsWith('.vtt') || srtResponse.data.startsWith('WEBVTT')) {
            // Едноставна конверзија од VTT во линкови
            const rawLines = srtResponse.data.split('\n');
            let vttOutput = "WEBVTT\n\n";
            for (let i = 0; i < rawLines.length; i++) {
                vttOutput += rawLines[i] + '\n';
            }
            // Директен превод на суровиот VTT фајл
            const translatedVtt = await translateText(vttOutput, 'sr');
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send(translatedVtt);
        } else {
            parsedSrt = parser.fromSrt(srtResponse.data);
            
            // Преведување линија по линија за стабилност
            let vttOutput = "WEBVTT\n\n";
            for (let i = 0; i < Math.min(parsedSrt.length, 300); i++) { // преведуваме сегментно за брзина
                const item = parsedSrt[i];
                const translatedText = await translateText(item.text, 'sr');
                vttOutput += `${i + 1}\n`;
                vttOutput += `${item.startTime.replace(',', '.')} --> ${item.endTime.replace(',', '.')}\n`;
                vttOutput += `${translatedText}\n\n`;
            }

            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send(vttOutput);
        }

    } catch (error) {
        console.error("Грешка при обработка:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при вчитување на титлот.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
