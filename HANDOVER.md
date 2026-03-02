# HRPB CRM - Handover Guide 🏗️

## Tumhara CRM Kaise Chalaye (Without Cipher)

### CRM Kya Hai?
Yeh tumhara client management system hai — Node.js + Express + SQLite pe bana hua. Ek single folder mein sab kuch hai, koi complex setup nahi.

### Files Structure
```
crm/
├── server.js          ← Backend (API + server)
├── public/
│   └── index.html     ← Frontend (pura UI)
├── crm.db             ← Database (sab data yahan hai)
├── package.json       ← Dependencies list
├── node_modules/      ← Installed packages
└── HANDOVER.md        ← Yeh file!
```

### CRM Kaise Start Karein

1. **Terminal/Command Prompt kholein**
2. CRM folder mein jaayein:
   ```bash
   cd /path/to/crm
   ```
3. Server chalayein:
   ```bash
   node server.js
   ```
4. Browser mein kholein: **http://localhost:3000**

### Login
- **Username:** admin
- **Password:** admin123
- ⚠️ Password zaroor change karna! (Team page se)

### Agar Link Kho Jaaye?

CRM local hai — tumhare computer pe chalta hai. Link hamesha hoga:
- **http://localhost:3000** (apne computer se)

Agar remote hosting pe hai (Koyeb/Railway/etc):
- Apna hosting dashboard check karo
- GitHub repo: `nawazarghan-sketch/hrpb-crm`

### Agar Server Band Ho Jaaye?
Bas dobara `node server.js` run karo. Data safe rahega (crm.db mein).

### Backup Kaise Lein?
- `crm.db` file copy kar lo — yeh tumhara sara data hai
- Poora `crm/` folder zip kar ke rakh lo

### GitHub Se Dobara Setup
```bash
git clone https://github.com/nawazarghan-sketch/hrpb-crm.git
cd hrpb-crm
npm install
node server.js
```

### Kuch Masla Aaye Toh?
1. Terminal mein error padhein
2. `node server.js` dobara chalayein
3. Agar module missing ho: `npm install` run karo
4. Agar database corrupt ho: `crm.db` delete karo (fresh start, data jayega)

### Admin Settings (Naya Feature)
- **Settings page** se interest levels add/remove karo
- **Custom fields** add karo clients ke liye
- **Theme** change karo apni pasand ka
- Sab kuch browser se — koi code nahi chhedna

---
*Yeh CRM tumhara hai. Cipher ke bina bhi chalega, bas `node server.js` yaad rakhna! 🔐*
