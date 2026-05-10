import { instagramGetUrl } from 'instagram-url-direct';

async function test() {
    try {
        const url = 'https://www.instagram.com/reel/DS2bSVUEyAc/';
        const res = await instagramGetUrl(url);
        console.log("Success with stripped url!");
        console.log(JSON.stringify(res, null, 2));
    } catch (e: any) {
        console.log("Failed stripped:", e.message);
    }
}
test();
