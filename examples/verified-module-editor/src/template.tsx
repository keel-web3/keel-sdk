import { defineTemplate, signal } from "@keel/sdk/module";

function Artwork() {
  const captures = signal(0);
  const label = signal("My artwork");
  return (
    <main style={{ fontFamily: "system-ui", padding: "32px", color: "#152436" }}>
      <h1>{label}</h1>
      <p>KEEL templates use the same modules and types as ordinary JavaScript.</p>
      <label>Artwork title <input value={label} onInput={event => { label.value = event.currentTarget.value; }} /></label>
      <svg width="320" height="200" viewBox="0 0 320 200" aria-label="Green circle artwork">
        <rect width="320" height="200" fill="#10202f" />
        <circle cx="160" cy="100" r="70" fill="#76f2bf" />
      </svg>
      <button onClick={() => { captures.value++; thumbnail.snapshot(label.value); }}>Capture thumbnail</button>
      <p>Captures: {captures}</p>
      <p>{() => captures.value === 1 ? "First capture sent." : "Ready for another capture."}</p>
      <p>Unverified module: {solarDates(2026).year}</p>
    </main>
  );
}

export default defineTemplate({
  name: "template-example",
  title: "KEEL template example",
  target: "@keel/eth/sepolia",
}, <Artwork />);
