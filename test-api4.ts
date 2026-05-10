import axios from 'axios';

async function test() {
    const urls = [
        'https://bk9.fun/download/instagram?url=',
        'https://api.vreden.web.id/api/igdownload?url=',
        'https://aemt.me/download/igdl?url=',
    ];

    const targetUrl = 'https://www.instagram.com/reel/DS2bSVUEyAc/?igsh=bXg3OW82YWdyMm9v';

    for (const url of urls) {
        try {
            console.log(`Testing ${url}`);
            const res = await axios.get(url + encodeURIComponent(targetUrl), { timeout: 10000 });
            console.log(`Success ${url}`);
            console.log(JSON.stringify(res.data, null, 2));
            return;
        } catch (e: any) {
            console.log(`Failed ${url}:`, e.message);
        }
    }
}
test();
