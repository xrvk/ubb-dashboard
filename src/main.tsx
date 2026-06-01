import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ThemeProvider } from 'next-themes'
import { App } from './App'
import { CredentialsProvider } from '@/hooks/use-credentials'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ErrorBoundary label="application root">
        <CredentialsProvider>
          <App />
        </CredentialsProvider>
      </ErrorBoundary>
    </ThemeProvider>
  </StrictMode>,
)
