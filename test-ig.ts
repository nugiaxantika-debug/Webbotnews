import { instagramGetUrl } from 'instagram-url-direct';

async function test() {
    try {
        const url = 'https://www.instagram.com/reel/DS2bSVUEyAc/?igsh=bXg3OW82YWdyMm9v';
        const res = await instagramGetUrl(url.split('?')[0]);
        console.log(JSON.stringify(res, null, 2));
    } catch(e: any) {
        console.error(e.message);
    }
}
test();
