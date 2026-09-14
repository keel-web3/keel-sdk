// Unverified upload used to demonstrate discovery and inferred argument types.
// This fixture does not contain an astronomical dataset.
function KEEL_solarDates(year = new Date().getUTCFullYear(), options = { includeLunar: false }) {
  return { year, includeLunar: options.includeLunar, dates: [] };
}
