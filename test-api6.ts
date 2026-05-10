import axios from "axios";
import { instagram } from "@jerrycoder/instagram-api";

async function test() {
    try {
        const url = 'https://www.instagram.com/reel/DS2bSVUEyAc/';
        const res = await instagram(url);
        console.log(JSON.stringify(res, null, 2));
    } catch(e: any) {
        console.error(e.message);
    }
}
test();
