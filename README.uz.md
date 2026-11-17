# ZONA — qanday ishga tushiriladi

ZONA — brauzerda ishlaydigan jamoaviy FPS o'yin. Bitta kompyuter **server** bo'ladi (hosting), do'stlar esa
**bitta WiFi / LAN** orqali brauzerda kirishadi. Internet, akkaunt yoki o'rnatish shart emas (faqat birinchi
marta kutubxonalarni yuklab olish uchun internet kerak).

Hozirgi holat: **M5** — 2–4 jamoa, neytral zonalar, 4 ta klass va gadjetlar, texnika (jip va tank), botlar,
**3-shaxs va tepadan kamera**, tugmalarni qayta sozlash, uzilgandan keyin qayta ulanish.

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
| Texnikaga o'tirish / tushish | E ni bosib turing (0.3 s) |
| Jip: haydash | W A S D |
| Tank: to'p / pulemyot | sichqonchaning chap / o'ng tugmasi (minora sichqonchaga ergashadi) |
| Yugurish / cho'kkalash / sakrash | Shift / C yoki Ctrl / Space |
| Qayta o'qlash | R |
| Hisob jadvali | Tab (bosib turing) |
| Katta xarita | M (bosib turing) |
| Kamera: 1-shaxs → 3-shaxs → tepadan | V |
| Yelkani almashtirish (3-shaxs) | Z |
| Statistika (FPS, draw calls, ping) | F3 |
| Menyu / sozlamalar | Esc |

Tugmalarni o'zgartirish: **Esc → Sozlamalar → Boshqaruv** — harakatni bosing, keyin yangi tugmani bosing
(Esc — bekor qilish). Tugma boshqa harakatda band bo'lsa, ikkalasi almashadi. "Standart tugmalar" — hammasini
qaytarish. Sichqoncha tugmalari, 1–4, Tab, F3 va Esc o'zgarmaydi.

### Kamera rejimlari

- **1-shaxs** — odatiy FPS ko'rinishi.
- **3-shaxs** — kamera o'ng yelka ortida (Z — chap yelkaga). Nishon (krestik) qayerga qarasa, o'q o'sha yerga
  ketadi; faqat o'yinchi bilan nishon orasida devor bo'lsa, o'qni devor oladi. Snayper nishonga olganda optika
  1-shaxsda ochiladi. Texnikada kamera orqadan kuzatadi.
- **Tepadan** — xarita yuqoridan, shimol doim tepada. Sichqoncha ekrandagi nishonni suradi, W/A/S/D ekran bo'yicha
  (W — tepaga) yuradi. Snayperda optika yo'q: o'ng tugma kamerani balandroq ko'taradi (ko'proq joy ko'rinadi).

Rejimni **V** bilan yoki **Sozlamalar → Umumiy → Kamera** da almashtirish mumkin.

### Ulanish uzilsa

WiFi bir zum uzilsa yoki sahifa yangilansa (F5), o'yin o'zi **qayta ulanadi** va siz o'sha jamoada, o'sha
hisob bilan davom etasiz (60 soniya ichida). Ekranda "Qayta ulanmoqda…" yozuvi chiqadi. 60 soniyadan keyin
server sizni chiqarib yuboradi (botlar yoqilgan bo'lsa, o'rningizga bot keladi).

### Klasslar

| Klass | HP | Asosiy qurol | Gadjetlar |
|---|---|---|---|
| Askar | 100 | AR-1 avtomat | Dori qutisi (3 m ichida 10 HP/s), 2 ta granata |
| Muhandis | 100 | SMG-1 | Ta'mir apparati, raketa otar (4 ta raketa) |
| Pulemyotchi | 120, sekinroq | LMG-1 (100 o'qli) | O'q qutisi |
| Snayper | 85 | BOLT-1 (4x optika, boshga tegsa o'ladi) | — |

Hammada to'pponcha bor.

### Botlar

Lobbida admin **Botlar: yoqilgan** qilib, "Har jamoani shu songacha to'ldirish" (0–8) va qiyinlikni (Oson / O'rta /
Qiyin) tanlaydi. Har jamoa shu songacha botlar bilan to'ldiriladi (jami 24 tagacha). O'yin davomida odam kirsa,
uning jamoasidagi bitta bot chiqadi. Botlar zonalarni egallaydi va himoya qiladi, otishadi, jarohatlansa ta'minot
qutisiga qaytadi. Hisob jadvalida 🤖 belgisi bilan ko'rinadi. Bitta o'zingiz ham botlarga qarshi o'ynashingiz mumkin.

### Texnika

- **Jip** (250 HP, 2 o'rin): har bir egallangan zona maydonchasida. Yo'lovchi o'z qurolidan oldinga qarab otadi.
  Tez yurgan jip dushmanni urib yuboradi.
- **Tank** (700 HP, 1 o'rin): faqat neytral zonalarda, zona egallangandan keyin paydo bo'ladi. To'p 3 s da qayta
  o'qlanadi, pulemyot 5 s otgandan keyin qizib qoladi.
- Bo'sh texnikaga istalgan o'yinchi o'tira oladi. Yo'q qilingan texnika maydonchada qayta paydo bo'ladi
  (jip 30 s, tank 75 s). Tashlab ketilgan texnika 60 s dan keyin maydonchaga qaytadi.
- Muhandis raketa otar (160 zarar) bilan texnikani yo'q qiladi va ta'mir apparati bilan o'z texnikasini tuzatadi.
  Zona ta'minot qutisi yonida texnika sekin tuzaladi. Lobbida "Texnika: o'chiq" qilish mumkin. O'z zonangizdagi ta'minot qutisi yonida (12 m) sog'liq va o'q tiklanadi.

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
| `bots.ts` | bot qiyinligi (reaksiya, nishon xatosi), ko'rish masofasi, ism ro'yxati, klasslar ulushi |
| `vehicles.ts` | jip va tank: HP, tezlik, burilish, to'p (zarar, qayta o'qlash), pulemyot qizishi, qayta paydo bo'lish vaqti |
| `movement.ts` | yurish 5.0 / yugurish 7.4 / cho'kkalash 2.6 m/s, sakrash, gravitatsiya, hitbox o'lchamlari |
| `zones.ts` | egallash radiusi 14 m, tezlik 5 %/s, kamayish 2 %/s, tug'ilish nuqtalari |
| `match.ts` | ochko/zona 0.5/s, chegaralar, qayta tug'ilish 5 s, himoya 2 s, sog'liq tiklanishi 8 s / 8 HP/s |
| `map.ts` | xarita o'lchami, relyef balandligi, daraxt/tosh/konteyner zichligi |
| `graphics.ts` | Past/O'rta/Yuqori presetlar: ko'rish masofasi, soyalar, draw-call byudjeti |
| `net.ts` | tarmoq chastotalari (30 Hz), interpolyatsiya kechikishi 100 ms |

## 6. O'z 3D modellaringizni qo'shish (ixtiyoriy)

O'yin hamma narsani o'zi chizadi (oddiy shakllardan), tashqi fayl kerak emas. Agar ruxsat berilgan litsenziyali
(masalan CC0) glTF/GLB model topsangiz, uni qo'shish mumkin:

1. Asl faylni `assets-src/` ga, o'yin uchun tayyor `.glb` faylni `packages/client/public/assets/models/` ga qo'ying.
2. `packages/client/public/assets/manifest.json` ga yozing:

   ```json
   { "version": 1, "models": {
     "vehicle.jeep": { "url": "models/jeep.glb", "scale": 1, "rotationY": 0, "offset": [0, 0, 0],
                       "license": "CC0", "source": "muallif, havola" }
   } }
   ```

   Kalitlar: `vehicle.jeep`, `vehicle.tank` va `prop.<turi>` (`pine`, `tree`, `rock`, `boulder`, `container`,
   `barrier`, `sandbags`, `ruin`, `tower`, `bunker`). `license` majburiy; faqat `assets/` ichidagi fayllar qabul
   qilinadi. Model 1 birlik = 1 metr, old tomoni −Z bo'yicha bo'lishi kerak (`rotationY` bilan to'g'rilanadi).
3. `CREDITS.md` ga muallif va litsenziyani yozing, `start.bat` ni qayta ishga tushiring.

Fayl topilmasa yoki buzuq bo'lsa, o'yin avvalgi oddiy modelni ishlatadi. Modellar kam poligonli bo'lsin
(jip ~2–5 ming, prop ~1–2 ming uchburchak), aks holda kuchsiz kompyuterlarda FPS tushadi.

## 7. Dasturchilar uchun

```
npm install
npm run dev      # server + Vite (http://localhost:5173)
npm run check    # typecheck + lint + unit testlar
npm run e2e      # Playwright: 2 ta brauzer sahifasi (birinchi marta: npx playwright install chromium)
npm run sim      # faqat botlar bilan headless o'yin (24 aktor, tick vaqti)
```
