import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const REQUESTS_FILE = resolve(__dirname, 'data/requests.json')
const TEAM_GROUP_ID = '5cfcde57-3369-4efb-abd9-d82a136c00f4'

function loadRequests() {
  if (!existsSync(REQUESTS_FILE)) return []
  return JSON.parse(readFileSync(REQUESTS_FILE, 'utf-8'))
}

function saveRequests(requests: unknown[]) {
  const dir = resolve(__dirname, 'data')
  if (!existsSync(dir)) {
    const { mkdirSync } = require('fs')
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2))
}

async function getCurrentUser(token: string) {
  const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) throw new Error('Failed to get current user')
  return res.json()
}

async function isTeamMember(token: string) {
  try {
    const res = await fetch(`https://graph.microsoft.com/v1.0/me/checkMemberGroups`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupIds: [TEAM_GROUP_ID] })
    })
    if (!res.ok) return false
    const data = await res.json()
    return (data.value || []).includes(TEAM_GROUP_ID)
  } catch {
    return false
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'fabric-api-proxy',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          // Semantic models endpoint
          const semanticMatch = req.url?.match(/^\/api\/semantic-models\/(.+)$/)
          if (semanticMatch) {
            const workspaceId = semanticMatch[1]
            try {
              const result = execSync(
                `fab api "workspaces/${workspaceId}/semanticModels" --output_format json`,
                { encoding: 'utf-8', timeout: 30000 }
              )
              const parsed = JSON.parse(result)
              const data = parsed.result.data[0].text
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(data))
            } catch {
              res.statusCode = 500
              res.end(JSON.stringify({ error: 'Failed to fetch semantic models' }))
            }
            return
          }

          // User search endpoint
          const userMatch = req.url?.match(/^\/api\/users\?q=(.+)$/)
          if (userMatch) {
            const query = decodeURIComponent(userMatch[1])
            try {
              const tokenPath = resolve(__dirname, '.graph-token')
              const token = readFileSync(tokenPath, 'utf-8').trim()
              const filter = `(startswith(displayName,'${query}') or startswith(mail,'${query}') or startswith(userPrincipalName,'${query}')) and accountEnabled eq true`
              const graphUrl = `https://graph.microsoft.com/v1.0/users?$filter=${encodeURIComponent(filter)}&$top=20&$select=id,displayName,mail,userPrincipalName`
              const response = await fetch(graphUrl, {
                headers: { Authorization: `Bearer ${token}` }
              })
              if (!response.ok) throw new Error(`Graph API: ${response.status}`)
              const data = await response.json()
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(data.value || []))
            } catch {
              res.statusCode = 500
              res.end(JSON.stringify([]))
            }
            return
          }

          // Submit request endpoint
          if (req.url === '/api/requests' && req.method === 'POST') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', async () => {
              try {
                const tokenPath = resolve(__dirname, '.graph-token')
                const token = readFileSync(tokenPath, 'utf-8').trim()
                const user = await getCurrentUser(token)
                const requestData = JSON.parse(body)
                const requests = loadRequests()
                const newRequest = {
                  id: `REQ-${String(requests.length + 1).padStart(4, '0')}`,
                  product: requestData.product,
                  requestType: requestData.requestType,
                  formData: requestData.formData,
                  status: 'Open',
                  createdAt: new Date().toISOString(),
                  userId: user.id,
                  userName: user.displayName,
                  userMail: user.mail || user.userPrincipalName,
                }
                requests.push(newRequest)
                saveRequests(requests)
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(newRequest))
              } catch (err) {
                res.statusCode = 500
                res.end(JSON.stringify({ error: 'Failed to save request' }))
              }
            })
            return
          }

          // Get requests endpoint
          if (req.url === '/api/requests' && req.method === 'GET') {
            try {
              const tokenPath = resolve(__dirname, '.graph-token')
              const token = readFileSync(tokenPath, 'utf-8').trim()
              const user = await getCurrentUser(token)
              const isAdmin = await isTeamMember(token)
              const requests = loadRequests()
              const filtered = isAdmin ? requests : requests.filter((r: { userId: string }) => r.userId === user.id)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(filtered))
            } catch {
              res.statusCode = 500
              res.end(JSON.stringify([]))
            }
            return
          }

          // Check if user is admin (TeamPBIDATA member)
          if (req.url === '/api/me' && req.method === 'GET') {
            try {
              const tokenPath = resolve(__dirname, '.graph-token')
              const token = readFileSync(tokenPath, 'utf-8').trim()
              const user = await getCurrentUser(token)
              const isAdmin = await isTeamMember(token)
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ...user, isAdmin }))
            } catch {
              res.statusCode = 500
              res.end(JSON.stringify({ error: 'Failed to get user info' }))
            }
            return
          }

          // Update request status (admin only)
          const updateMatch = req.url?.match(/^\/api\/requests\/(.+)\/status$/)
          if (updateMatch && req.method === 'PUT') {
            let body = ''
            req.on('data', chunk => { body += chunk })
            req.on('end', async () => {
              try {
                const tokenPath = resolve(__dirname, '.graph-token')
                const token = readFileSync(tokenPath, 'utf-8').trim()
                const isAdmin = await isTeamMember(token)
                if (!isAdmin) {
                  res.statusCode = 403
                  res.end(JSON.stringify({ error: 'Not authorized' }))
                  return
                }
                const { status, resolutionComment } = JSON.parse(body)
                const requestId = decodeURIComponent(updateMatch[1])
                const tokenPath2 = resolve(__dirname, '.graph-token')
                const token2 = readFileSync(tokenPath2, 'utf-8').trim()
                const adminUser = await getCurrentUser(token2)
                const requests = loadRequests()
                const idx = requests.findIndex((r: { id: string }) => r.id === requestId)
                if (idx === -1) {
                  res.statusCode = 404
                  res.end(JSON.stringify({ error: 'Request not found' }))
                  return
                }
                requests[idx].status = status
                if (!requests[idx].tracking) requests[idx].tracking = []
                requests[idx].tracking.push({
                  status,
                  timestamp: new Date().toISOString(),
                  userName: adminUser.displayName,
                  userMail: adminUser.mail || adminUser.userPrincipalName,
                  ...(resolutionComment ? { comment: resolutionComment } : {})
                })
                if (resolutionComment) {
                  requests[idx].resolutionComment = resolutionComment
                  requests[idx].resolvedAt = new Date().toISOString()
                }
                saveRequests(requests)
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(requests[idx]))
              } catch {
                res.statusCode = 500
                res.end(JSON.stringify({ error: 'Failed to update request' }))
              }
            })
            return
          }

          next()
        })
      },
    },
  ],
})
