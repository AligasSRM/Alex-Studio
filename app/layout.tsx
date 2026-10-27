export const metadata = {
  title: 'Alex Studio',
  description: 'AI-assisted local project studio',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
