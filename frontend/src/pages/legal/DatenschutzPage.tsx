/** Datenschutzerklärung (Art. 13 DSGVO). Legal prose lives here as content,
 * deliberately outside the i18n dictionary (single-language legal text). */

import './legal.css';

export function DatenschutzPage() {
  return (
    <div className="legal">
      <h1>Datenschutzerklärung</h1>
      <p>Stand: 26. Juli 2026</p>

      <h2>1. Verantwortlicher</h2>
      <p>
        Martin Pfeffer, Flughafenstraße 24, 12053 Berlin,{' '}
        <a href="mailto:martin.pfeffer@celox.io">martin.pfeffer@celox.io</a> (siehe{' '}
        <a href="/impressum">Impressum</a>).
      </p>

      <h2>2. Überblick</h2>
      <p>
        Zauberkoch ist ein KI-Rezept- und Cocktail-Generator. Wir verarbeiten so wenig Daten wie möglich:
        Es gibt <strong>keine Werbe- oder Analyse-Tracker</strong>, keine Drittanbieter-Cookies und keinen
        Verkauf von Daten. Ein Cookie-Banner ist nicht erforderlich, weil ausschließlich technisch
        notwendige Cookies eingesetzt werden (§ 25 Abs. 2 Nr. 2 TDDDG).
      </p>

      <h2>3. Server-Logdateien</h2>
      <p>
        Beim Aufruf der Seite verarbeitet unser Server (Standort: EU) automatisch IP-Adresse, Datum und
        Uhrzeit, aufgerufene URL, User-Agent und Referrer in Logdateien. Rechtsgrundlage ist unser
        berechtigtes Interesse an Betriebssicherheit und Missbrauchsabwehr (Art. 6 Abs. 1 lit. f DSGVO).
        Logdateien werden turnusmäßig gelöscht. Zur Begrenzung von Missbrauch werden IP-Adressen zudem
        kurzzeitig für Ratenbegrenzungen im Arbeitsspeicher verarbeitet.
      </p>

      <h2>4. Cookies und lokale Speicherung</h2>
      <ul>
        <li>
          <strong>Session-Cookie</strong> (httpOnly): hält deine Anmeldung aufrecht. Technisch notwendig,
          Löschung bei Abmeldung bzw. Ablauf.
        </li>
        <li>
          <strong>OAuth-State-Cookie</strong>: sichert den Google-Anmeldevorgang gegen Manipulation ab
          (Lebensdauer wenige Minuten).
        </li>
        <li>
          <strong>localStorage</strong>: speichert Einstellungen wie Theme und Ansichtswahl ausschließlich
          auf deinem Gerät; keine Übertragung an uns.
        </li>
      </ul>

      <h2>5. Registrierung mit Google Sign-In</h2>
      <p>
        Die Anmeldung erfolgt über Google OAuth (Google Ireland Limited, Gordon House, Barrow Street,
        Dublin 4, Irland). Wir erhalten dabei deine E-Mail-Adresse, deinen Namen und dein Profilbild und
        speichern diese zur Bereitstellung deines Kontos (Art. 6 Abs. 1 lit. b DSGVO). Es gilt ergänzend die{' '}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
          Datenschutzerklärung von Google
        </a>
        . Bei Einladung durch andere Nutzer speichern wir deine E-Mail-Adresse in einer Freischaltliste.
      </p>

      <h2>6. Registrierung mit E-Mail und Passwort</h2>
      <p>
        Alternativ kannst du dich mit E-Mail-Adresse und Passwort registrieren. Wir speichern deine
        E-Mail-Adresse sowie dein Passwort ausschließlich als <strong>kryptografischen Hash</strong>{' '}
        (scrypt mit Zufalls-Salt) — dein Klartext-Passwort wird nie gespeichert (Art. 6 Abs. 1 lit. b DSGVO).
        Zur Bestätigung deiner Adresse und zum Zurücksetzen des Passworts versenden wir zeitlich befristete,
        signierte Links per E-Mail; bis zur Bestätigung bleibt das Konto inaktiv. Der E-Mail-Versand erfolgt
        über unseren Mail-Anbieter Hostinger (Absender <em>support@celox.io</em>). Bei jeder Neuregistrierung
        wird der Betreiber datenminimal benachrichtigt (E-Mail-Adresse, Name sofern angegeben, Anmeldemethode,
        Browsersprache, Zeitpunkt) — eine IP-Adresse wird dabei nicht übermittelt.
      </p>

      <h2>7. KI-Verarbeitung (Anthropic)</h2>
      <p>
        Zur Rezept-Erzeugung übermitteln wir deine Eingaben — gewählte Küche, Geschmacksrichtungen,
        Rahmenbedingungen, angegebene Zutaten/Vorräte sowie optional ein von dir aufgenommenes
        Kühlschrank-Foto — an die Anthropic PBC (USA) als Auftragsverarbeiter. Rechtsgrundlage ist die
        Erfüllung der Nutzung (Art. 6 Abs. 1 lit. b DSGVO). Die Übermittlung in die USA erfolgt auf
        Grundlage der EU-Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO), die Bestandteil des
        Auftragsverarbeitungsvertrags mit Anthropic sind. Anthropic verwendet API-Daten vertraglich{' '}
        <strong>nicht zum Training</strong> seiner Modelle; API-Logs werden dort nach kurzer Frist gelöscht.
        Kühlschrank-Fotos werden ausschließlich zur Zutatenerkennung verarbeitet und von uns{' '}
        <strong>nicht gespeichert</strong>. Bitte fotografiere keine Personen oder sensiblen Dokumente.
      </p>

      <h3>Optionaler eigener API-Schlüssel</h3>
      <p>
        Du kannst freiwillig einen eigenen Anthropic-API-Schlüssel hinterlegen; dann laufen die
        Anfragen über dein Anthropic-Konto und ohne unser Tageslimit. Wir speichern den Schlüssel{' '}
        <strong>verschlüsselt</strong> (AES-256-GCM), geben ihn nie an deinen Browser oder Dritte
        zurück und zeigen dir nur die letzten vier Zeichen, damit du erkennst, welcher Schlüssel
        hinterlegt ist. Er erscheint auch nicht in deinem Datenexport. Rechtsgrundlage ist deine
        Einwilligung durch die Eingabe (Art. 6 Abs. 1 lit. a DSGVO); du kannst ihn jederzeit im
        Profil entfernen, womit er sofort gelöscht wird. Für die Nutzung deines Schlüssels gelten
        zusätzlich die Bedingungen von Anthropic dir gegenüber; abgerechnet wird über dein dortiges
        Konto.
      </p>

      <h2>8. Inhalte deines Kontos</h2>
      <p>
        Generierte Rezepte, Favoriten, Notizen, Feedback, Wochenpläne, Einkaufslisten, Vorräte und
        Einstellungen speichern wir, solange dein Konto besteht (Art. 6 Abs. 1 lit. b DSGVO). Zur
        Kostenkontrolle führen wir tagesbezogene Nutzungszähler sowie technische Nutzungsstatistiken
        (Token-Verbrauch ohne Inhaltsdaten).
      </p>

      <h2>9. Geteilte Rezepte und Galerie</h2>
      <p>
        Wenn du ein Rezept teilst, ist es über den erzeugten Link ohne Anmeldung abrufbar (ohne Nennung
        deines Namens). Aktivierst du zusätzlich die öffentliche Galerie, erscheint das Rezept auf der
        Startseite und in der Sitemap (Suchmaschinen). Beides kannst du jederzeit widerrufen; der Link wird
        dadurch ungültig.
      </p>

      <h2>10. Empfänger und Hosting</h2>
      <p>
        Die Anwendung läuft auf einem von uns administrierten Server in der EU (Hostinger International
        Ltd. als Infrastruktur-Anbieter). Eine Weitergabe personenbezogener Daten an sonstige Dritte findet
        nicht statt, außer wir sind gesetzlich dazu verpflichtet.
      </p>

      <h2>11. Deine Rechte</h2>
      <p>
        Du hast das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17),
        Einschränkung (Art. 18), Datenübertragbarkeit (Art. 20) und Widerspruch (Art. 21 DSGVO).
      </p>
      <p>
        <strong>Auskunft, Datenübertragbarkeit und Löschung kannst du direkt in der App ausüben</strong>{' '}
        — ohne Anfrage und ohne Wartezeit: unter „Mein Profil“ findest du „Alle meine Daten
        herunterladen“ (vollständiger Export als JSON-Datei, in einem gängigen maschinenlesbaren
        Format) und „Konto löschen“.
      </p>
      <p>
        Die Löschung erfolgt sofort und endgültig. Entfernt werden dein Konto, alle Rezepte samt
        Notizen und Bewertungen, Favoriten, Einkaufsliste, Wochenplan, geteilte Links und deine
        Sitzungen. Erhalten bleiben zwei Dinge ohne Bezug zu deiner Person: der anonyme
        Nutzungszähler zur Kostenabrechnung (Zeitpunkt, Modus, Dauer — die Zuordnung zu deinem Konto
        wird dabei gelöscht) und bereits erzeugte Rezepttexte in unserem technischen
        Zwischenspeicher, der ausschließlich über einen Hashwert der Rezeptparameter angesprochen
        wird und keine Nutzerkennung enthält.
      </p>
      <p>
        Für die übrigen Rechte oder bei Fragen genügt eine formlose E-Mail an{' '}
        <a href="mailto:martin.pfeffer@celox.io">martin.pfeffer@celox.io</a>. Du hast außerdem ein
        Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde, z.&nbsp;B. der Berliner Beauftragten
        für Datenschutz und Informationsfreiheit.
      </p>

      <h2>12. Änderungen</h2>
      <p>
        Wir passen diese Erklärung an, wenn sich die App oder die Rechtslage ändert. Es gilt die jeweils
        hier veröffentlichte Fassung.
      </p>
    </div>
  );
}
