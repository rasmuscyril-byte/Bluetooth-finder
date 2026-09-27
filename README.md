# 📍 iPad-finder

Find en mistet iPad (eller telefon) ved at følge dens Bluetooth-signal. Programmet viser en
**varm/kold-måler** og kan bippe som en **geigertæller**: jo tættere du kommer, jo hurtigere bip.

Alt kører lokalt på din egen computer. Intet sendes til internettet.

---

## 1. Først: prøv Apples egen Find-app

Det er næsten altid det hurtigste:

1. Gå til **[icloud.com/find](https://www.icloud.com/find)** på en hvilken som helst computer eller telefon,
   eller åbn **Find**-appen på en anden Apple-enhed (også en i din familiedeling).
2. Log ind med dit Apple-ID, vælg iPad'en og tryk **Afspil lyd**. Den spiller lyd, selvom den står på lydløs.
3. Står iPad'en som *offline*, kan du se dens sidst kendte placering. Slå **Giv besked, når den findes** til.

Brug iPad-finder, hvis iPad'en er i nærheden men gemt (sofaen, en taske, bilen, klubhuset),
hvis lyden ikke hjælper, eller hvis du ikke kan logge ind lige nu.

---

## 2. Kom i gang

Du skal bruge en computer med Bluetooth – helst en bærbar, så du kan gå rundt med den.

**Hent programmet:** Tryk på den grønne knap **Code → Download ZIP** her på GitHub, og pak ZIP-filen ud.

### Windows

1. Har du ikke Python, så hent det på [python.org/downloads](https://www.python.org/downloads/).
   Sæt flueben i **"Add python.exe to PATH"** under installationen.
2. Dobbeltklik på **`start-windows.bat`**. Viser Windows en blå boks ("Windows beskyttede din pc"),
   så tryk **Flere oplysninger → Kør alligevel**.
3. Første gang henter programmet Bluetooth-biblioteket *bleak* (kræver internet, tager et minuts tid).
   Derefter åbner iPad-finder af sig selv i din browser.

### Mac

1. Højreklik på **`start-mac.command`** og vælg **Åbn** (første gang skal du bekræfte, at du vil åbne den).
   På nyere macOS skal du i stedet gå til **Systemindstillinger → Anonymitet og sikkerhed** og trykke
   **Åbn alligevel** – eller bruge Terminal-metoden herunder, som altid virker.
2. Macen spørger, om Terminal må bruge Bluetooth – tryk **Tillad**.
   Spørger den ikke, så gå til **Systemindstillinger → Anonymitet og sikkerhed → Bluetooth** og slå Terminal til.
3. Browseren åbner af sig selv.

Virker dobbeltklik ikke, så åbn Terminal og skriv (ret stien, så den passer til hvor du pakkede ud):

```bash
cd ~/Downloads/Bluetooth-finder-main
bash start-mac.command
```

Macens indbyggede Python virker. Mangler den, beder Macen dig installere "kommandolinjeværktøjer",
eller også kan du hente Python på [python.org](https://www.python.org/downloads/).

> **Har du en Mac?** Så kan du også bruge **Find**-appen direkte på Macen (se punkt 1).

### Linux

```bash
./start-linux.sh
```

### Android-telefon (eksperimentelt)

Chrome på Android kan scanne Bluetooth direkte fra en hjemmeside, hvis du slår en eksperimentel funktion til:

1. Skriv `chrome://flags` i adresselinjen, søg efter **Experimental Web Platform features**, vælg **Enabled** og genstart Chrome.
2. Åbn iPad-finder-siden via **https** (se nedenfor) og tryk **Start scanning**. Tillad Bluetooth (og placering).

Siden kan lægges på nettet gratis med GitHub Pages: gå til repoets **Settings → Pages**, vælg
**Deploy from a branch**, vælg grenen og mappen **/ (root)**, og gem. Så ligger siden på
`https://rasmuscyril-byte.github.io/Bluetooth-finder/`.

> iPhone og iPad kan ikke scanne Bluetooth fra en hjemmeside – Apple tillader det ikke. Brug en computer eller en Android-telefon.

### Vil du bare se, hvordan det ser ud?

Start programmet med `--demo` (fx `start-windows.bat --demo` fra kommandoprompten eller
`bash start-mac.command --demo`). Så vises nogle simulerede enheder, og du kan prøve varm/kold-måleren uden Bluetooth.

---

## 3. Sådan leder du

1. **Start tæt på, hvor du sidst havde iPad'en.** Listen **iPads & telefoner** viser de enheder, der kan være din iPad,
   med det stærkeste signal øverst.
2. **Udeluk det, du kender.** Din telefon i hånden står øverst med "Brændende varm!". Tryk **Ikke den** på den og på
   andre enheder, du ved, hvad er.
3. **Tryk Identificér** (kun når programmet kører på en computer). Så spørger iPad-finder enheden om dens model.
   Svarer den fx `iPad13,1`, er det en iPad. Mange enheder svarer ikke – det er normalt.
4. **Tryk Find den.** Nu ser du en stor måler. Slå **lyd** til og gå langsomt rundt:
   - Rødere måler og hurtigere bip = varmere. Blå måler og langsomme bip = koldere.
   - Stå stille 2–3 sekunder hvert sted – signalet svinger.
   - Drej rundt om dig selv: din krop dæmper signalet, så det er stærkest, når du vender mod iPad'en.
   - Kig under puder, i tasker, skuffer, bilen og sportstasken.

### Gode tricks

- **Ring op med FaceTime** eller send iPad'en en besked. Skærmen vågner, iPad'en sender oftere – og måske hører du den.
- **Sig højt "Hej Siri".** Hører iPad'en dig, kan den svare. Samtidig sender den et kort signal, der fortæller, at den er en
  iPad – fanger iPad-finder det, skifter kortet til **iPad**.
- **Har iPad'en mobildata?** Åbn Wi-Fi-indstillingerne på din iPhone eller Mac (samme Apple-ID). Så svarer iPad'en måske med et
  signal, der også viser dens batteriniveau ("iPhone eller iPad med mobildata").
- **Er iPad'en væk hjemmefra** (fx i bilen eller i klubhuset) og uden internet, sender den et **Find My-signal**.
  Det vises som "iPhone, iPad eller Mac uden internet (Find My)".

### Hvad betyder kortene?

| På kortet står der | Det betyder |
| --- | --- |
| **iPhone, iPad eller Mac** | En Apple-enhed. Ud fra signalet alene kan man ikke se forskel – brug *Identificér* eller udelukkelsesmetoden. |
| **iPad** · *sandsynlig* | Enheden har selv fortalt, at den er en iPad (fx efter "Hej Siri", via en Microsoft-app eller dens navn). |
| **iPad** · *sikker* | *Identificér* gav et modelnummer, der starter med "iPad". |
| **… uden internet (Find My)** | En Apple-enhed uden internetforbindelse. God kandidat, hvis iPad'en er væk hjemmefra. |
| *Låst / ikke i brug*, *I brug lige nu* … | Hvad enheden laver lige nu (ifølge dens eget signal). |
| **AirPods**, **AirTag**, **Apple Watch** … | Genkendt som noget andet end en iPad. |

---

## 4. Godt at vide (ærligt)

- **iPad'en skal være tændt.** Er batteriet fladt, sender den intet. (Nyere iPhones kan findes et stykke tid efter,
  de er slukket – det kan iPads så vidt vides ikke.)
- **Flytilstand eller slukket Bluetooth** betyder intet signal.
- En låst iPad, der ligger helt stille, kan sende sjældnere. Væk den med et FaceTime-opkald eller en besked.
- **Afstanden er kun et skøn.** Vægge, møbler, vand (og mennesker) gør signalet svagere. Følg hellere
  *varmere/koldere* end metertallet.
- Bluetooth rækker typisk 10–30 meter indendørs.
- Apple-enheder skifter Bluetooth-adresse cirka hvert kvarter. Så "forsvinder" enheden og dukker op som en ny.
  iPad-finder forsøger selv at genfinde den, mens du bruger **Find den**.
- *Identificér* virker ikke på alle enheder og alle iPadOS-versioner.
- Du ser også andre folks enheder. Brug kun programmet til at finde dine egne ting.

---

## 5. Fejlfinding

| Problem | Løsning |
| --- | --- |
| "Bluetooth er slået fra" | Slå Bluetooth til på computeren. Programmet prøver selv igen hvert 5. sekund. |
| Mac: ingen enheder | Giv Terminal adgang: **Systemindstillinger → Anonymitet og sikkerhed → Bluetooth**. |
| Windows: ingen enheder | Computeren skal have Bluetooth 4.0 eller nyere (Bluetooth Low Energy) og Windows 10 (1709) eller nyere. |
| Linux: "Bluetooth-tjenesten svarer ikke" | `sudo systemctl start bluetooth` |
| Browseren åbner ikke | Åbn adressen, der står i vinduet (normalt `http://127.0.0.1:8765/`). |
| Virker Bluetooth overhovedet? | Kør `start-windows.bat --check` (Windows, fra kommandoprompten) eller `bash start-mac.command --check` (Mac). Den scanner i 10 sekunder og skriver, hvad den fandt. |

---

## 6. For de nysgerrige – sådan virker det

```
Bluetooth-radio ──► ipad_finder (Python + bleak) ──► lokal webserver (127.0.0.1) ──► browser (web/)
                    scanner og "Identificér"         Server-Sent Events               afkoder, genkender,
                                                                                      udglatter, viser
```

- `ipad_finder/` – et lille Python-program. Det scanner med [bleak](https://github.com/hbldh/bleak) (Windows, macOS og Linux)
  og sender de rå Bluetooth-signaler til browseren. Det bruger kun Pythons standardbibliotek ud over bleak.
- `web/` – selve appen (ren HTML/CSS/JavaScript uden eksterne afhængigheder). Den afkoder Apples
  "Continuity"-beskeder (Nearby Info, Handoff, Find My, Proximity Pairing, Hej Siri m.fl.), genkender producenter,
  udglatter signalstyrken med et Kalman-filter og tegner måleren. Samme kode bruges af computer-versionen,
  browser-scanning (Web Bluetooth) og demoen.
- **Identificér** forbinder kort til enheden og læser *Device Information* (model-nummer, fx `iPad13,1`).

Kilder til protokol-detaljerne: [furiousMAC/continuity](https://github.com/furiousMAC/continuity),
Celosia & Cunche (*Discontinued Privacy*, 2020, og deres [joker](https://github.com/gcelosia/joker)-dissector),
[seemoo-lab/AirGuard](https://github.com/seemoo-lab/AirGuard), [FindMy.py](https://github.com/malmeloo/FindMy.py),
Heinrich m.fl. (*Who Can Find My Devices?*, 2021) og Bluetooth SIG's *Assigned Numbers*.

### Udvikling og tests

```bash
python -m pip install -r requirements-dev.txt
python -m pytest                      # Python-broen (uden rigtig Bluetooth)
node --test tests/js/*.test.js        # afkodning, genkendelse, signal, tracker, kilder
node tests/e2e/run-e2e.mjs            # hele appen i en rigtig browser (kræver Playwright)
python -m ipad_finder --demo          # demo i browseren
```

Kræver Python 3.9+ og (til JavaScript-testene) Node.js 20+.
