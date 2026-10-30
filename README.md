# MR Tinder

Code review na telefonie dla GitLaba i GitHuba: jedna karta = jeden plik z MR/PR.

- **w prawo** → plik obejrzany (następna karta)
- **w lewo** → tryb wyboru linii: dotknij linii albo przeciągnij palcem po diffie (przy krawędzi przewija) → komentarz.
  Komentarze w drafcie widać pod linią, można je edytować i usuwać.
- na końcu: **Approve** albo **Wyślij komentarze bez approve**, opcjonalnie quiz ze zmian (Gemini)

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
W zakładce „Repozytoria” przy MR jest „+ MR z tym samym branchem w innych repo”.

## Kolejność przepływu

Pliki są domyślnie ułożone wzdłuż przepływu kodu: plik, który w zmienionych liniach woła metodę albo używa klasy,
jest przed plikiem z jej definicją (od punktu wejścia w dół), potem pliki bez powiązań, testy na końcu.
To zgadywanie z nazw (bez kompilatora), więc wywołania przez interfejsy, eventy czy refleksję mogą umknąć.
🗺 w talii pokazuje mapę (drzewo wywołań, skok do pliku, przełącznik „Przepływ / Pliki”), a z kluczem Gemini
można poprosić AI o kolejność z krótkim opisem roli każdego pliku (zapamiętywaną do następnego pusha).

## Ograniczenia

- Checkbox „Viewed” w GitLabie jest trzymany tylko w przeglądarce (nie ma API), więc stan „obejrzane” jest lokalny.
  Zapamiętywany jest hash diffu pliku — po nowym pushu zmienione pliki wracają do talii.
- GitHub nie pozwala dokładać komentarzy do oczekującego review pojedynczo, więc drafty komentarzy do PR-ów są
  trzymane na urządzeniu i wysyłane jednym review przy Approve / wysłaniu komentarzy. Komentować można tylko linie diffu
  (nie odsłonięty kontekst), a komentarze do całego pliku trafiają do treści review.
- Wyszukiwarka GitHuba pozwala na ~30 zapytań na minutę, więc wyniki są przez minutę cache'owane.
