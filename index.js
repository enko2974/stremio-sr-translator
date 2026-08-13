const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
});

const manifest = {
    id: 'org.stremio.sr.subtitlecat',
    version: '1.2.0',
    name: 'SubtitleCat SR-Latin Subtitles',
    description: 'Директни српски титлови од SubtitleCat.',
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
        id: `subcat-sr-${id}`,
        url: `https://${req.get('host')}/subcat-proxy/${type}/${id}.vtt`,
        lang: 'sr',
        label: 'Serbian (SubtitleCat Auto-Latin)'
    }];

    res.json({ subtitles });
});

app.get('/subcat-proxy/:type/:id.vtt', async (req, res) => {
    const { id } = req.params;
    const parts = id.split(':');
    const imdbId = parts[0];
    const season = parts[1];
    const episode = parts[2];

    const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
    };

    try {
        // 1. Пребарај на SubtitleCat според IMDb ID
        let searchQuery = imdbId;
        if (season && episode) {
            const s = season.padStart(2, '0');
            const e = episode.padStart(2, '0');
            searchQuery += ` S${s}E${e}`;
        }

        const searchUrl = `https://www.subtitlecat.com/index.php?search=${encodeURIComponent(searchQuery)}`;
        const searchRes = await axios.get(searchUrl, { headers });
        const $ = cheerio.load(searchRes.data);

        // Најди ги сите резултати
        let pageUrl = null;
        $('table.sub-table tbody tr').each((i, el) => {
            const link = $(el).find('a').attr('href');
            if (link && link.includes('/subtitles/')) {
                if (!pageUrl) pageUrl = link;
            }
        });

        if (!pageUrl) {
            // Обиди се со пребарување само по IMDb ID
            const fallbackRes = await axios.get(`https://www.subtitlecat.com/index.php?search=${imdbId}`, { headers });
            const $fb = cheerio.load(fallbackRes.data);
            const fbLink = $fb('table.sub-table tbody tr a').attr('href');
            if (fbLink) pageUrl = fbLink;
        }

        if (!pageUrl) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nНе е пронајдена страница за овој наслов на SubtitleCat.");
        }

        const fullPageUrl = pageUrl.startsWith('http') ? pageUrl : `https://www.subtitlecat.com/${pageUrl.replace(/^\//, '')}`;
        
        // 2. Отвори ја страницата на титлот за да ги најдеме преведените фајлови
        const subPageRes = await axios.get(fullPageUrl, { headers });
        const $sub = cheerio.load(subPageRes.data);

        // Влечење на линк до VTT/SRT фајл (српски, хрватски или босански)
        let downloadLink = null;
        
        // Бараме линк за преземање или AJAX линк за српски/хрватски/босански
        $sub('a').each((i, el) => {
            const href = $sub(el).attr('href') || '';
            const text = $sub(el).text().toLowerCase();
            if ((href.includes('sr') || href.includes('hr') || text.includes('serbian') || text.includes('croatian')) && (href.endsWith('.vtt') || href.endsWith('.srt'))) {
                downloadLink = href;
            }
        });

        // Ако нема директен а-таг, го земаме стандардниот преведен линк од SubtitleCat структурата
        if (!downloadLink) {
            // SubtitleCat ги зачувува преведените VTT фајлови во /subs/
            const match = fullPageUrl.match(/\/subtitles\/[a-z]{2}\/(.+)\.html/);
            if (match && match[1]) {
                const baseName = match[1];
                downloadLink = `https://www.subtitlecat.com/subs/${baseName}-sr.vtt`;
            }
        }

        if (!downloadLink) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nНема достапен српски превод за овој фајл.");
        }

        const finalSubUrl = downloadLink.startsWith('http') ? downloadLink : `https://www.subtitlecat.com/${downloadLink.replace(/^\//, '')}`;
        
        // 3. Преземи го саканиот титл
        let fileRes = await axios.get(finalSubUrl, { headers, responseType: 'text' }).catch(() => null);

        // Ако српскиот сè уште не врати податоци, обиди се со хрватски (-hr.vtt)
        if (!fileRes || !fileRes.data || fileRes.data.trim().length === 0) {
            const hrUrl = finalSubUrl.replace('-sr.vtt', '-hr.vtt');
            fileRes = await axios.get(hrUrl, { headers, responseType: 'text' }).catch(() => null);
        }

        if (fileRes && fileRes.data) {
            let content = fileRes.data;
            if (!content.startsWith('WEBVTT')) {
                content = "WEBVTT\n\n" + content;
            }
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            return res.send(content);
        }

        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка при преземање на преведената датотека.");

    } catch (error) {
        console.error("Scraper Error:", error.message);
        res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
        res.send("WEBVTT\n\n1\n00:00:01.000 --> 00:00:05.000\nГрешка во серверот при пребарување.");
    }
});

const PORT = process.env.PORT || 7000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
