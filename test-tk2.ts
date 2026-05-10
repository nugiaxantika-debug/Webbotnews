import axios from 'axios';

async function test() {
    try {
        const url = 'https://vt.tiktok.com/ZS9q4XRga/';
        const res = await axios.get(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
        console.log("Play:", res.data?.data?.play);
        console.log("Music:", res.data?.data?.music);
    } catch(e: any) {
        console.error(e.message);
    }
}
test();
