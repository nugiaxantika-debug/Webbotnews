import "dotenv/config";
import instadl from '@mrnima/instagram-downloader';

async function test() {
    try {
        const url = 'https://www.instagram.com/reel/DS2bSVUEyAc/?igsh=bXg3OW82YWdyMm9v';
        const res = await instadl(url);
        console.log(JSON.stringify(res, null, 2));
    } catch(e: any) {
        console.error(e.message);
    }
}
test();
