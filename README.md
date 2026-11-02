# MR Tinder

Code review na telefonie dla GitLaba i GitHuba: jedna karta = jeden plik z MR/PR.

- **w prawo** → plik obejrzany (następna karta)
- **w lewo** → tryb wyboru linii: dotknij linii albo przeciągnij palcem po diffie (przy krawędzi przewija) → komentarz.
  Komentarze w drafcie widać pod linią, można je edytować i usuwać.
- na końcu: **Approve**, a gdy są komentarze **Wyślij komentarze** albo **Wyślij komentarze i approve**

## Start

```sh
npm install
npm run dev        # nasłuchuje też w LAN — otwórz http://<ip-maca>:5173 na telefonie
```

Przy pierwszym uruchomieniu aplikacja proponuje połączenie GitLaba i/lub GitHuba; konta zmienia się w ustawieniach (⚙︎).

- **GitLab:** adres instancji + Personal Access Token ze scope `api`.
- **GitHub:** personal access token (classic) ze scope `repo`; opcjonalnie adres GitHub Enterprise.
  Przy organizacjach z SSO token trzeba autoryzować („Configure SSO”).

Tokeny zostają tylko w przeglądarce. Aplikacja jest czysto statyczna i gada bezpośrednio z API
(GitLab i GitHub mają CORS dla swoich API). Urządzenie musi mieć dostęp do GitLaba (np. VPN dla instancji firmowej).

## Deploy

GitHub Pages: push na `main` uruchamia `.github/workflows/pages.yml`.
Jednorazowo: Settings → Pages → Source: **GitHub Actions**.

## Taski (feature w kilku repo)

MR/PR-y są grupowane po kluczu Jiry (np. `ABC-123`) z tytułu lub brancha — także między GitLabem a GitHubem.
Task przeglądasz jako jedną talię i na końcu możesz zrobić „Approve wszystkie”.
Przy otwartym MR w zakładce „Obserwowane” jest „+ MR z tym samym branchem”.

## Obserwowane repozytoria

W ⚙︎ wybierasz repozytoria albo cały projekt (grupa GitLaba / organizacja lub konto GitHuba — wpisz np. `wings-of-heroes`)
do obserwowania; projekt obejmuje też repozytoria dodane do niego później; zakładka „Obserwowane” pokazuje ich MR (otwarte i zmergowane)
zaktualizowane w ostatnich 2 dniach, a „Pokaż starsze” podwaja ten okres.
MR z tym samym kluczem Jiry (albo, bez klucza, z tym samym branchem) są złączone w jeden task, jak w „Do review”.
MR z obejrzanymi wszystkimi plikami, ale bez Twojego approve, ma fioletową ramkę „👁 Obejrzane” (stan trzymany na urządzeniu,
po nowym pushu zmienia się na „są nowe zmiany”).

## Ograniczenia

- Checkbox „Viewed” w GitLabie jest trzymany tylko w przeglądarce (nie ma API), więc stan „obejrzane” jest lokalny.
  Zapamiętywany jest hash diffu pliku — po nowym pushu zmienione pliki wracają do talii.
- GitHub nie pozwala dokładać komentarzy do oczekującego review pojedynczo, więc drafty komentarzy do PR-ów są
  trzymane na urządzeniu i wysyłane jednym review przy Approve / wysłaniu komentarzy. Komentować można tylko linie diffu
  (nie odsłonięty kontekst), a komentarze do całego pliku trafiają do treści review.
- Cofnięcie approve na GitHubie to odrzucenie (dismiss) własnego review — wymaga uprawnień do odrzucania review w repo.
- Wyszukiwarka GitHuba pozwala na ~30 zapytań na minutę, więc wyniki są przez minutę cache'owane.
