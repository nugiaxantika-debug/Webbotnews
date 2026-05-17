import btch from "btch-downloader";
import axios from "axios";
async function test() {
    try {
        const yt = await btch.youtube("https://www.youtube.com/watch?v=kffacxfA7G4");
        console.log("got link", yt.mp3);
        const res = await axios.get(yt.mp3, { responseType: "arraybuffer", headers: { "User-Agent": "Mozilla/5.0" } });
        console.log("got buffer", res.data.byteLength);
    } catch(e) {
        console.error(e.message);
    }
}
test();
