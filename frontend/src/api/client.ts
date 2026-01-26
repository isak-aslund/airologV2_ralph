import axios from 'axios'

// Use same hostname as the frontend, but on port 8000
const getApiUrl = () => {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL
  }
  const { protocol, hostname } = window.location
  return `${protocol}//${hostname}:8000/api`
}

const client = axios.create({
  baseURL: getApiUrl(),
  headers: {
    'Content-Type': 'application/json',
  },
})

export default client
