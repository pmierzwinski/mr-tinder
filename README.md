# MR Tinder

Code review na telefonie: jedna karta = jeden plik z MR.

- **w prawo** → plik obejrzany (następna karta)
- **w lewo** → komentarz (stuknij linię w diffie, żeby był przypięty do linii)
- na końcu: **Wyślij review** (publikuje draft comments) albo **Approve**

## Start

```sh
npm install
npm run dev        # nasłuchuje też w LAN — otwórz http://<ip-maca>:5173 na telefonie
```

Logowanie: adres GitLaba + Personal Access Token z scope `api` (link do utworzenia jest na ekranie logowania).
Oba zostają tylko w przeglądarce. Aplikacja jest czysto statyczna i gada bezpośrednio z GitLab API
(GitLab domyślnie ma CORS dla `/api/*`). Urządzenie musi mieć dostęp do GitLaba (np. VPN dla instancji firmowej).

## Deploy

GitHub Pages: push na `main` uruchamia `.github/workflows/pages.yml`.
Jednorazowo: Settings → Pages → Source: **GitHub Actions**.

## Grupy MR (feature w kilku repo)

Na liście „Do review” MR-y są grupowane po kluczu Jiry (np. `ABC-123`) z nazwy brancha lub tytułu,
a jeśli go nie ma — po nazwie brancha. Grupę przeglądasz jako jedną talię i na końcu możesz zrobić „Approve wszystkie”.
W zakładce „Repozytoria” przy MR jest „+ MR z tym samym branchem w innych repo”.

## Ograniczenia

- Checkbox „Viewed” w GitLabie jest trzymany tylko w przeglądarce (nie ma API), więc stan „obejrzane” jest lokalny.
  Zapamiętywany jest hash diffu pliku — po nowym pushu zmienione pliki wracają do talii.
