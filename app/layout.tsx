export const metadata = {
  title: 'Integration API',
  description: 'KOMMO + bet30 webhook integration service',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
