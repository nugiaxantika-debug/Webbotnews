import axios from 'axios';

async function test() {
    try {
        const url = 'https://vt.tiktok.com/ZS9q4XRga/';
        const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        
        console.log("Play:", res.data?.data?.play);
        
        try {
            const vidRes = await axios.get(res.data.data.play, { responseType: 'arraybuffer' });
            console.log("Video Buffer Size:", Buffer.from(vidRes.data).length);
        } catch (e: any) {
            console.error("Video download failed:", e.message);
        }
    } catch(e: any) {
        console.error(e.message);
    }
}
test();
