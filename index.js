const express = require('express');
const axios = require('axios');

const app = express();

// Овозможи CORS
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.stremio.sr.subtitlecat',
    version: '1.1.0',
    name: 'SubtitleCat SR-Latin Subtitles',
    description: 'Автоматски српски латинични титлови директно од SubtitleCat.',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    catalogs: []
};

app.get('/manifest.json', (req, res) => {
    res.json(manifest);
});

// 1. Понуди го титлот во Stremio/Nuvio
app.get('/subtitles/:type/:id/:extra?.json', async (req, res) => {
    const { type, id } = req.params;

    const subtitles = [{
        id: `subcat-sr-${id}`,
        url: `https://${req.get('host')}/subcat-proxy/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (SubtitleCat Auto-Latin)'
    }];

    res.json({ subtitles });
});

// 2. Логика за пребарување и влечење титл од SubtitleCat
app.get('/subcat-proxy/:type/:id.vtt', async (req, res) => {
    const { id } = req.params;
    
    // id доаѓа во формат "tt1234567" или за серии "tt1234567:1:2" (imdb:season:episode)
    const parts = id.split(':');
    const imdbId = parts[0];
    const season = parts[1];
    const episode = parts[2];

    try {
        // Пребарување на SubtitleCat според IMDb ID
        const searchUrl = `https://www.subtitlecat.com/index.php?search=${imdbId}`;
        const searchRes = await axios.get(searchUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });

        const html = searchRes.data;
        
        // Наоѓање на првиот релевантен линк за титл
        let pageLink = null;
        const matches = html.match(/\/subtitles\/[a-zA-Z0-9-]+\.html/g);

        if (matches && matches.length > 0) {
            if (season && episode) {
                // За серии: Бараме линк кој ги содржи S01E02 или 1x02 ознаките
                const sPattern = season.padStart(2, '0');
                const ePattern = episode.padStart(2, '0');
                const epQuery = `s${sPattern}e${ePattern}`;
                const altEpQuery = `${season}x${ePattern}`;
                
                const foundEp = matches.find(m => m.toLowerCase().includes(epQuery) || m.toLowerCase().includes(altEpQuery));
                pageLink = foundEp || matches[0];
            } else {
                pageLink = matches[0];
            }
        }

        if (!pageLink) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nНе е пронајден титл на SubtitleCat.");
        }

        // Креирање на директен линк до српскиот/хрватскиот .vtt или .srt фајл од SubtitleCat
        // SubtitleCat користи стандардизирана патека за преведените титлови: /subtitles/sr/ или /subtitles/hr/
        const subCatBase = pageLink.replace('/subtitles/', '').replace('.html', '');
        
        // Се обидуваме да го преземеме српскиот преведен фајл од SubtitleCat
        let subFileUrl = `https://www.subtitlecat.com/subs/${subCatBase}-sr.vtt`;
        let subRes = await axios.get(subFileUrl, { responseType: 'text' }).catch(() => null);

        // Ако нема српски, го преземаме хрватскиот (hr) кој е исто така латиница и соодветен
        if (!subRes || !subRes.data) {
            subFileUrl = `https://www.subtitlecat.com/subs/${subCatBase}-hr.vtt`;
            subRes = await axios.get(subFileUrl, { responseType: 'text' }).catch(() => null);
        }

        if (subRes && subRes.data) {
            let vttData = subRes.data;
            // Обезбеди се дека содржината има WEBVTT заглавие
            if (!vttData.startsWith('WEBVTT')) {
                vttData = "WEBVTT\n\n" + vttData;
            }
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send(vttData);
        }

        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nТитлот постои, но фајлот не можеше да се преземе.");

    } catch (error) {
        console.error("SubtitleCat Proxy Error:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при поврзување со SubtitleCat.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
