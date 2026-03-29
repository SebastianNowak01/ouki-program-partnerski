# Program partnerski - sklep z telefonami

Projekt na zajecia: frontend React + backend Express + SQLite.

## Co dziala (MVP)

1. **Flow 1 - link partnera i cookie**
   - Partner tworzy konto i dostaje link w formacie `/?ref=P-XXXXXX`.
   - Klient wchodzi przez link, backend zapisuje klik i ustawia cookie `partner_ref` na 30 dni.

2. **Flow 2 - zakup po czasie i prowizja**
   - Klient moze kupic telefon nawet wiele dni pozniej.
   - Jezeli cookie partnera nadal istnieje, zamowienie jest przypisywane partnerowi.
   - Automatycznie nalicza sie prowizja (10%).

3. **Flow 3 - panel partnera i mock wyplaty**
   - Partner widzi naliczone prowizje i ich status (`accrued`, `requested`, `paid`).
   - Dashboard pokazuje, czy wyplata jest mozliwa i czy partner juz jej zazadal.
   - Mozna zasymulowac przelew bankowy (`mock transfer`) i zamknac payout.

## Stack

- **Frontend:** React 19, TypeScript, Vite, Tailwind, komponenty w stylu shadcn/ui
- **Backend:** Express 5 (Node.js)
- **Baza:** SQLite (`server/data/affiliate.sqlite`) przez `better-sqlite3`

## Uruchomienie

```bash
npm install
npm run dev
```

Aplikacja web: `http://localhost:5173`
API backendu: `http://localhost:3001`

## Przydatne endpointy

- `POST /api/partners` - tworzenie partnera
- `POST /api/track-click` - zapis klikniecia i cookie partnera
- `POST /api/orders` - symulacja zakupu i naliczanie prowizji
- `GET /api/partner/:refCode/dashboard` - podglad prowizji i payoutow
- `POST /api/partner/:refCode/payout-request` - zlecenie wyplaty
- `POST /api/payouts/:payoutId/mock-transfer` - mock przelew na konto partnera

## Build frontendu

```bash
npm run build
npm run preview
```
