import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app'
import './index.css'

import { AppProvider } from './context/AppContext'

// MUI imports
import { ThemeProvider, CssBaseline } from '@mui/material'
import { createTheme } from '@mui/material/styles'

// Minimal, safe theme
const theme = createTheme({
  palette: {
    mode: 'light', // switch to 'dark' later if you want
  },
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppProvider>
        <App />
      </AppProvider>
    </ThemeProvider>
  </React.StrictMode>,
)
