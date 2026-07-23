import axios from 'axios'

export const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'

const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('docmind_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    if (error.response?.status === 401) {
      // Decentralized Safety Net: session expired or revoked server-side.
      // Clear cache and redirect to login. Works for all users including guests
      // (whose 24h token may expire naturally).
      localStorage.removeItem('docmind_token')
      localStorage.removeItem('docmind_user')
      window.location.href = '/login'
    }
    return Promise.reject(error.response?.data || error)
  }
)

export default api
