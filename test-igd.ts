import { instagramGetUrl } from 'instagram-url-direct';
import axios from 'axios';

async function test() {
    try {
        const url = 'https://www.instagram.com/reel/DX-2C--RzTU/?igsh=MXc0ODA2a3h0bHJvYg==';
        console.log("Checking...", url);
        const res = await instagramGetUrl(url);
        console.log("Got URLs");
        
        for (const item of res.url_list) {
            console.log("Downloading... ", item.substring(0, 50));
            try {
                const itemRes = await axios.get(item, { responseType: 'arraybuffer' });
                const buf = Buffer.from(itemRes.data);
                console.log("Buffer size:", buf.length);
            } catch (e: any) {
                console.error("AXIOS ERROR:", e.message);
            }
        }
    } catch (e: any) {
        console.error(e);
    }
}
test();
