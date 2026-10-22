/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brandRed: '#FF0000',
        // Secondary text on the black background was too dim to read comfortably (zinc-600 was about 2.6:1).
        // Lifting these two steps keeps the same hierarchy but meets contrast guidelines.
        zinc: { 500: '#8e8e98', 600: '#74747e' },
      }
    },
  },
  plugins: [],
}