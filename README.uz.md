# ZONA — qanday ishga tushiriladi

ZONA — brauzerda ishlaydigan jamoaviy FPS o'yin. Bitta kompyuter **server** bo'ladi (hosting), do'stlar esa
**bitta WiFi / LAN** orqali brauzerda kirishadi. Internet, akkaunt yoki o'rnatish shart emas (faqat birinchi
marta kutubxonalarni yuklab olish uchun internet kerak).

Hozirgi holat: **M2** — 2–4 jamoa, neytral zonalar, 4 ta klass (Askar, Muhandis, Pulemyotchi, Snayper) va gadjetlar.

## 1. Talablar

- Windows 10/11 (yoki Linux/macOS).
- **Node.js 22 LTS** — https://nodejs.org (yuklab oling va "Next" bosib o'rnating).
- Brauzer: Chrome, Edge yoki Firefox'ning so'nggi versiyasi (WebGL2 kerak).

## 2. Serverni ishga tushirish (Windows)

1. Loyihani kompyuterga yuklab oling (`git clone` yoki GitHub'dan ZIP qilib).
2. `scripts` papkasidagi **`start.bat`** faylini ikki marta bosing.
   - Birinchi marta kutubxonalar o'rnatiladi va o'yin yig'iladi (1–3 daqiqa).
   - Keyingi safarlar darhol ishga tushadi. Kod yangilansa (`git pull`), avtomatik qayta yig'iladi.
3. Qora oynada shunday yozuvlar chiqadi:

   ```
   ZONA server is running.
   On this PC:        http://localhost:3000
   Friends on LAN:    http://192.168.1.23:3000
   ```

   va QR-kod (telefonda ochib manzilni ko'rish uchun qulay).
4. **Windows Firewall** oynasi chiqsa: **"Private networks"** (shaxsiy tarmoqlar) ga belgi qo'yib,
   **"Allow access"** ni bosing. Bu bo'lmasa do'stlaringiz ulana olmaydi.

Serverni to'xtatish: qora oynani yoping yoki `Ctrl+C` bosing.

Linux/macOS: `./scripts/start.sh`.

## 3. O'ynash

- **O'zingiz (server kompyuterida):** brauzerda `http://localhost:3000` ni oching.
- **Do'stlar:** o'sha WiFi'ga ulanib, brauzerda serverda ko'rsatilgan `http://192.168.x.x:3000` manzilni ochadi.
- Ism yozing → **"O'yinga kirish"**. Birinchi kirgan o'yinchi — **admin**.
- Lobbida jamoa tanlang ("Shu jamoaga o'tish" yoki "Avto jamoa"). Admin jamoalar sonini (2–4), neytral zonalarni
  (Avto yoki qo'lda), xarita kodi (seed), ochko va vaqt chegarasini tanlab **"O'yinni boshlash"** ni bosadi.
  "Aralashtirish" — jamoalarni tasodifiy teng bo'lish.
- O'yin boshlanishidan oldin va har o'limdan keyin **spawn ekrani** chiqadi: klass kartasini bosing (yoki 1–4),
  xaritada zonani tanlang (yoki zona harfi), **"Tushish"** (Space) ni bosing.
- O'yin boshlanganda ekranni bir marta bosing — sichqoncha o'yinga "qulflanadi". `Esc` — menyu.

### Boshqaruv

| Harakat | Tugma |
|---|---|
| Yurish | W A S D |
| Qarash | sichqoncha |
| Otish (yoki tanlangan gadjetni ishlatish) / nishonga olish | sichqonchaning chap / o'ng tugmasi |
| Qurol/gadjet tanlash | 1 2 3 4 yoki g'ildirak |
| Gadjetni qo'yish (dori/o'q qutisi) | Q |
| Tez granata (Askar) | G |
| Yugurish / cho'kkalash / sakrash | Shift / C yoki Ctrl / Space |
| Qayta o'qlash | R |
| Hisob jadvali | Tab (bosib turing) |
| Statistika (FPS, draw calls, ping) | F3 |
| Menyu / sozlamalar | Esc |

### Klasslar

| Klass | HP | Asosiy qurol | Gadjetlar |
|---|---|---|---|
| Askar | 100 | AR-1 avtomat | Dori qutisi (3 m ichida 10 HP/s), 2 ta granata |
| Muhandis | 100 | SMG-1 | Ta'mir apparati (texnika M3 da), raketa otar (4 ta raketa) |
| Pulemyotchi | 120, sekinroq | LMG-1 (100 o'qli) | O'q qutisi |
| Snayper | 85 | BOLT-1 (4x optika, boshga tegsa o'ladi) | — |

Hammada to'pponcha bor. O'z zonangizdagi ta'minot qutisi yonida (12 m) sog'liq va o'q tiklanadi.

### Qoidalar (qisqacha)

- Har bir jamoa o'z zonasidan boshlaydi. Zona = tug'ilish joyi = ochko manbai.
- Zonani egallash: ichida (14 m doira) faqat sizning jamoangiz bo'lsin. Avval raqib nazorati 0 gacha tushadi
  (1 kishi — 20 s), keyin sizniki 100 gacha ko'tariladi (yana 20 s). Ko'p odam — tezroq.
- Ikki jamoa bir zonada bo'lsa — zona "talashilmoqda", hech narsa o'zgarmaydi, u yerda tug'ilib bo'lmaydi.
- Har bir egallangan zona jamoaga sekundiga 0.5 ochko beradi.
- G'alaba: ochko chegarasi, vaqt tugashi, barcha zonalarni 60 s ushlab turish, yoki raqib jamoaning
  zonasi qolmasa va hamma o'yinchisi o'lsa.

## 4. Muammolar va yechimlar

- **Do'stlar ulana olmayapti:**
  - Firewall'da Node.js "Private" tarmoqqa ruxsat berilganini tekshiring:
    *Windows Security → Firewall & network protection → Allow an app through firewall → Node.js → Private* ✔.
  - Wi-Fi tarmog'ingiz turi "Public" bo'lsa, uni **"Private"** ga o'zgartiring:
    *Settings → Network & Internet → Wi-Fi → (tarmoq) → Network profile type → Private*.
  - Ba'zi WiFi tarmoqlar (kafe, mehmonxona, ayrim routerlar) qurilmalarni bir-biridan **ajratib qo'yadi**
    ("client/AP isolation"). Bunday holda **telefoningizdan hotspot** yoqing va hamma kompyuterlar shu
    hotspot'ga ulansin.
  - Manzil `localhost` emas, server oynasidagi `192.168...` manzil bo'lishi kerak.
- **"Port 3000 is already in use":** boshqa server ochiq qolgan. Uni yoping yoki boshqa port bilan ishga tushiring:
  `set PORT=3001 && npm start`.
- **"WebGL2 qo'llab-quvvatlanmaydi":** brauzerni yangilang, videokarta drayverini yangilang; Chrome'da
  *Settings → System → Use graphics acceleration* yoqilgan bo'lsin.
- **FPS past:** `Esc → Sozlamalar → Grafika: Past`, "Render masshtabi" ni 70–80% ga tushiring.
- **Ctrl+W:** Ctrl — cho'kkalash tugmasi; brauzer Ctrl+W bilan tabni yopishga harakat qilsa, o'yin "Sahifadan
  chiqasizmi?" deb so'raydi — "Qolish" ni bosing. Qulayroq bo'lishi uchun cho'kkalashga **C** dan foydalaning.

## 5. Sozlash mumkin bo'lgan raqamlar

Hamma o'yin raqamlari `packages/shared/src/config/` papkasida. O'zgartirgandan keyin `start.bat` ni qayta
ishga tushiring (avtomatik qayta yig'iladi).

| Fayl | Nima bor |
|---|---|
| `weapons.ts` | AR-1, SMG-1, LMG-1, BOLT-1, to'pponcha, raketa otar: zarar, tezlik (RPM), o'qdon, qayta o'qlash, sochilish, tepish |
| `classes.ts` | klasslar: HP, tezlik, slotlar |
| `gadgets.ts` | dori/o'q qutisi, granata (5 m, 100 zarar), raketa, zona ta'minoti (12 m, 8 HP/s) |
| `movement.ts` | yurish 5.0 / yugurish 7.4 / cho'kkalash 2.6 m/s, sakrash, gravitatsiya, hitbox o'lchamlari |
| `zones.ts` | egallash radiusi 14 m, tezlik 5 %/s, kamayish 2 %/s, tug'ilish nuqtalari |
| `match.ts` | ochko/zona 0.5/s, chegaralar, qayta tug'ilish 5 s, himoya 2 s, sog'liq tiklanishi 8 s / 8 HP/s |
| `map.ts` | xarita o'lchami, relyef balandligi, daraxt/tosh/konteyner zichligi |
| `graphics.ts` | Past/O'rta/Yuqori presetlar: ko'rish masofasi, soyalar, draw-call byudjeti |
| `net.ts` | tarmoq chastotalari (30 Hz), interpolyatsiya kechikishi 100 ms |

## 6. Dasturchilar uchun

```
npm install
npm run dev      # server + Vite (http://localhost:5173)
npm run check    # typecheck + lint + unit testlar
npm run e2e      # Playwright: 2 ta brauzer sahifasi (birinchi marta: npx playwright install chromium)
npm run sim      # 24 aktorli headless simulyatsiya (server tick vaqti)
```
