import { useState, useEffect } from 'react'
import { SearchableSelect } from './SearchableSelect'
import { UserSearch } from './UserSearch'
import './App.css'

type Category = 'power-bi' | 'power-platform' | 'pbidata-operations' | 'my-requests' | null
type RequestType = string | null

interface FormData {
  // Semantic Model Info
  workspaceName: string
  fabricCapacity: string
  semanticModelName: string
  // Data Source Info
  environment: string
  dataSourceType: string
  sourceData: string
  // Users
  usersToShare: string
  // Comments
  comments: string
}

const POWER_BI_REQUESTS = [
  'New Fabric Workspace',
  'New Data Source in Data Gateway',
  'Access to Existing Data Source',
  'New Deployment Pipeline',
  'New Snowflake Cloud Connection',
]

const FABRIC_CAPACITIES = [
  { id: 'eb0841d1-9fbc-4596-ac77-3db94148bfe7', name: 'fabricfbcweu1proicare021', sku: 'F64' },
  { id: '6ebabff6-11aa-4ed9-af8e-582c2f1af6d0', name: 'pbiproP1Transport', sku: 'P1' },
  { id: 'c2191fa8-efc0-489c-8db6-c23c5ebcd2ab', name: 'fabricfbcweu1prodataecomm019', sku: 'F128' },
  { id: 'add763fc-29c1-47a1-8796-068e18f1bfde', name: 'fabricfbcweu1protienda020', sku: 'F128' },
  { id: '37e5e592-6640-47fa-beb9-5d11127d7f69', name: 'fabricfbcweu1procomercial017', sku: 'F128' },
  { id: '6f100e9f-598d-485b-87d2-348e628829dc', name: 'fabricfbcweu1prorrhh018', sku: 'F128' },
  { id: '6fe3cba2-e2c0-447f-878b-74a387f7c012', name: 'fabricfbcweu1prodataecomm016', sku: 'F128' },
  { id: 'ccb2ebf0-0ace-4341-a263-9c83412638c8', name: 'fabricfbcweu1prodataecommareas014', sku: 'F64' },
  { id: '3f6ce512-37bd-4b2d-b9d7-60e7ff17caa0', name: 'fabricfbcweu1prodataecommcadenas015', sku: 'F64' },
  { id: '1a3ff9f2-a3cb-42b5-b0bb-b822f076a0c7', name: 'fabricfbcweu1procorporativo011', sku: 'F128' },
  { id: '1e2f5b26-813a-4a8e-8ebc-265c8951f261', name: 'fabricfbcweu1prozaraespana013', sku: 'F64' },
  { id: '5647f210-ea8f-4edf-91e9-d32fa795cf12', name: 'fabricfbcweu1prologistics010', sku: 'F64' },
  { id: 'f20d9b3b-93d2-4f8e-99f2-f28f0c18aca5', name: 'fabricfbcweu1prostockmanagement008', sku: 'F64' },
  { id: '6d80f0a3-c47e-4206-a7f9-21255fa8b0a0', name: 'fabricfbcweu1probershka004', sku: 'F64' },
  { id: '6a4aa9d7-68d2-41e9-95b4-7d35a494ee67', name: 'fabricfbcweu1prosostenibilidad007', sku: 'F64' },
  { id: '479badc8-f6c2-48b7-9e89-8498440195bb', name: 'fabricfbcweu1prooyp006', sku: 'F64' },
  { id: '06cbd350-0043-4f32-b020-ab63a9bc81be', name: 'fabricfbcweu1profinanciero005', sku: 'F64' },
  { id: '8b376c41-76f2-457b-b048-3b58477f3690', name: 'fabricfbcweu1propbidata009', sku: 'F64' },
  { id: '0fdc0884-82ad-43a9-8e0e-8c4e7577d940', name: 'fabricfbcweu1prologisticszcom003', sku: 'F64' },
  { id: '366412eb-e6cf-4f0b-8f0e-ef384312f5e4', name: 'fabricfbcweu1promassimodutti001', sku: 'F64' },
  { id: 'd3b63d6f-b65f-4b46-a263-5eb3d66eea6f', name: 'fabricfbcweu1prostradivarius002', sku: 'F64' },
  { id: '33e95abe-5ab3-41ed-ac1a-4d5b01595d54', name: 'pbiproP1pbidata1', sku: 'P1' },
  { id: '4ef6a650-cbee-4ea2-b5b1-d8ea6b32e30e', name: 'pbiproP1zarahome', sku: 'P1' },
  { id: '40a5f9d8-f64a-4189-86bd-1c36a492594c', name: 'pbiproP1tempe', sku: 'P1' },
  { id: '0dd77d0d-18e6-4ada-8b42-9913b67a92b9', name: 'pbiproP1pullbear', sku: 'P1' },
  { id: '6b84b405-563c-4518-a8d4-82540ac8bd2c', name: 'lodaplpbiweu1pro002import', sku: 'A4' },
  { id: '66e331e2-46bf-430b-b865-31f542998034', name: 'lodaplpbiweu1pro001dq', sku: 'A4' },
  { id: '2b4c7cc7-ea43-4e17-9c22-e6525c4557d5', name: 'Trial-20260226T174803Z', sku: 'FTL64' },
  { id: '1bb0fa4d-4438-4ef5-81e9-ef3f09fa8163', name: 'Premium Per User - Reserved', sku: 'PP3' },
].filter(c =>
  !c.name.toLowerCase().startsWith('trial') &&
  !c.name.toLowerCase().startsWith('premium') &&
  !c.name.toLowerCase().startsWith('loda')
).sort((a, b) => a.name.localeCompare(b.name))

const POWER_PLATFORM_REQUESTS = [
  'Access to an Environment as Maker',
  'Unblock a Prebuilt Connector',
  'Add Endpoint Filtering Rules for a Prebuilt Connector',
  'Permissions to Use a Gateway',
  'Licenses to Run a Power Apps Premium App',
]

const PBIDATA_OPERATIONS_REQUESTS: string[] = []

function App() {
  const [category, setCategory] = useState<Category>(null)
  const [requestType, setRequestType] = useState<RequestType>(null)
  const [formData, setFormData] = useState<FormData>({
    workspaceName: '',
    fabricCapacity: '',
    semanticModelName: '',
    environment: '',
    dataSourceType: '',
    sourceData: '',
    usersToShare: '',
    comments: '',
  })
  const [submitted, setSubmitted] = useState(false)
  const [semanticModels, setSemanticModels] = useState<{id: string; name: string}[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [selectedUsers, setSelectedUsers] = useState<{id: string; displayName: string; mail: string}[]>([])
  const [myRequests, setMyRequests] = useState<{id: string; product: string; requestType: string; status: string; createdAt: string; userName: string; formData?: Record<string, unknown>}[]>([])
  const [loadingRequests, setLoadingRequests] = useState(false)
  const [selectedRequest, setSelectedRequest] = useState<{id: string; product: string; requestType: string; status: string; createdAt: string; userName: string; userMail?: string; formData?: Record<string, unknown>; resolutionComment?: string; tracking?: {status: string; timestamp: string; userName: string; userMail: string; comment?: string}[]} | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [resolutionComment, setResolutionComment] = useState('')

  // Check if current user is admin
  useEffect(() => {
    fetch('/api/me')
      .then(res => res.json())
      .then(data => setIsAdmin(data.isAdmin || false))
      .catch(() => setIsAdmin(false))
  }, [])

  // Fetch user requests when My Requests is selected
  useEffect(() => {
    if (category !== 'my-requests') return
    setLoadingRequests(true)
    fetch('/api/requests')
      .then(res => res.json())
      .then(data => setMyRequests(data))
      .catch(() => setMyRequests([]))
      .finally(() => setLoadingRequests(false))
  }, [category])

  // Fetch semantic models when workspace changes
  useEffect(() => {
    if (!formData.workspaceName) {
      setSemanticModels([])
      return
    }
    setLoadingModels(true)
    setSemanticModels([])
    fetch(`/api/semantic-models/${formData.workspaceName}`)
      .then(res => res.json())
      .then(data => {
        const models = (data.value || []).map((m: { id: string; displayName: string }) => ({
          id: m.id,
          name: m.displayName,
        }))
        setSemanticModels(models.sort((a: {name: string}, b: {name: string}) => a.name.localeCompare(b.name)))
      })
      .catch(() => setSemanticModels([]))
      .finally(() => setLoadingModels(false))
  }, [formData.workspaceName])

  const handleBack = () => {
    if (requestType) {
      setRequestType(null)
      setSubmitted(false)
    } else if (category) {
      setCategory(null)
      setSelectedRequest(null)
    }
  }

  const handleInputChange = (field: keyof FormData, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      // Resolve display names for workspace and semantic model
      const capacityName = FABRIC_CAPACITIES.find(c => c.id === formData.fabricCapacity)?.name || formData.fabricCapacity
      const modelName = semanticModels.find(m => m.id === formData.semanticModelName)?.name || formData.semanticModelName

      const payload = {
        product: category === 'power-bi' ? 'Power BI' : category === 'power-platform' ? 'Power Platform' : 'PBIDATA Operations',
        requestType,
        formData: {
          ...formData,
          fabricCapacityName: capacityName,
          workspaceDisplayName: formData.workspaceName ? undefined : '',
          semanticModelDisplayName: modelName,
          usersToShare: selectedUsers.map(u => ({ id: u.id, name: u.displayName, mail: u.mail })),
        },
      }
      // Fetch workspace name from loaded JSON
      const wsRes = await fetch('/workspaces.json')
      const workspaces = await wsRes.json()
      const ws = workspaces.find((w: {id: string}) => w.id === formData.workspaceName)
      if (ws) payload.formData.workspaceDisplayName = ws.name

      await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      setSubmitted(true)
    } catch {
      alert('Error submitting request')
    }
  }

  const renderBreadcrumb = () => {
    const parts: string[] = ['Home']
    if (category) parts.push(category === 'power-bi' ? 'Power BI' : category === 'power-platform' ? 'Power Platform' : category === 'pbidata-operations' ? 'PBIDATA Operations' : 'My Requests')
    if (requestType) parts.push(requestType)
    return (
      <nav className="breadcrumb">
        {parts.map((part, i) => (
          <span key={i}>
            {i > 0 && <span className="separator"> › </span>}
            <span className={i === parts.length - 1 ? 'current' : ''}>{part}</span>
          </span>
        ))}
      </nav>
    )
  }

  const renderCategorySelection = () => (
    <div className="card-grid">
      <button className="card" onClick={() => setCategory('power-bi')}>
        <div className="card-icon">📊</div>
        <h2>Power BI</h2>
        <p>Fabric workspaces, data sources, deployment pipelines, and more</p>
      </button>
      <button className="card" onClick={() => setCategory('power-platform')}>
        <div className="card-icon">⚡</div>
        <h2>Power Platform</h2>
        <p>Environment access, connectors, gateways, and licenses</p>
      </button>
      <button className="card" onClick={() => setCategory('pbidata-operations')}>
        <div className="card-icon">🛠️</div>
        <h2>PBIDATA Operations</h2>
        <p>Internal tasks exclusive to the PBIDATA team</p>
      </button>
      <button className="card" onClick={() => setCategory('my-requests')}>
        <div className="card-icon">📋</div>
        <h2>My Requests</h2>
        <p>Track the status of your submitted requests</p>
      </button>
    </div>
  )

  const renderRequestSelection = () => {
    const requests = category === 'power-bi' ? POWER_BI_REQUESTS : category === 'power-platform' ? POWER_PLATFORM_REQUESTS : PBIDATA_OPERATIONS_REQUESTS
    return (
      <div className="request-list">
        {requests.map(req => (
          <button
            key={req}
            className="request-item"
            onClick={() => {
              setRequestType(req)
              setFormData({
                workspaceName: '',
                fabricCapacity: '',
                semanticModelName: '',
                environment: '',
                dataSourceType: '',
                sourceData: '',
                usersToShare: '',
    comments: '',
              })
              setSelectedUsers([])
            }}
          >
            <span>{req}</span>
            <span className="arrow">→</span>
          </button>
        ))}
      </div>
    )
  }

  const renderMyRequests = () => {
    if (selectedRequest) {
      return renderRequestDetail()
    }

    if (loadingRequests) {
      return <div className="placeholder-form"><p>Loading requests...</p></div>
    }

    if (myRequests.length === 0) {
      return <div className="placeholder-form"><p>No requests found.</p></div>
    }

    return (
      <div className="my-requests">
        <table className="requests-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Product</th>
              <th>Request Type</th>
              <th>Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {myRequests.map(req => (
              <tr key={req.id} className="request-row" onClick={() => setSelectedRequest(req)}>
                <td>{req.id}</td>
                <td>{req.product}</td>
                <td>{req.requestType}</td>
                <td>{new Date(req.createdAt).toLocaleDateString()}</td>
                <td><span className={`status-badge status-${req.status.toLowerCase().replace(' ', '-')}`}>{req.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const renderRequestDetail = () => {
    if (!selectedRequest) return null
    const fd = selectedRequest.formData || {}

    const fieldLabels: Record<string, string> = {
      fabricCapacity: 'Fabric Capacity',
      fabricCapacityName: 'Fabric Capacity',
      workspaceName: 'Workspace',
      workspaceDisplayName: 'Workspace Name',
      semanticModelName: 'Semantic Model',
      semanticModelDisplayName: 'Semantic Model Name',
      environment: 'Environment',
      dataSourceType: 'Data Source Type',
      sourceData: 'Source Data',
      usersToShare: 'Users to Share',
      comments: 'Comments',
    }


    return (
      <div className="request-detail">
        <button className="back-btn" onClick={() => setSelectedRequest(null)}>← Back to list</button>
        <fieldset>
          <legend>Request Details</legend>
          <div className="detail-row">
            <span className="detail-label">ID</span>
            <span className="detail-value">{selectedRequest.id}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Product</span>
            <span className="detail-value">{selectedRequest.product}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Request Type</span>
            <span className="detail-value">{selectedRequest.requestType}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Status</span>
            <span className={`status-badge status-${selectedRequest.status.toLowerCase().replace(' ', '-')}`}>{selectedRequest.status}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Date</span>
            <span className="detail-value">{new Date(selectedRequest.createdAt).toLocaleString()}</span>
          </div>
          <div className="detail-row">
            <span className="detail-label">Submitted by</span>
            <span className="detail-value">{selectedRequest.userName} {selectedRequest.userMail ? `(${selectedRequest.userMail})` : ''}</span>
          </div>
        </fieldset>

        {Object.keys(fd).length > 0 && (
          <fieldset>
            <legend>Form Data</legend>
            {['fabricCapacityName', 'workspaceDisplayName', 'semanticModelDisplayName', 'environment', 'dataSourceType', 'sourceData', 'usersToShare', 'comments'].map(key => {
              const value = fd[key]
              if (!value || (Array.isArray(value) && value.length === 0)) return null
              const label = fieldLabels[key] || key
              let displayValue: string
              if (Array.isArray(value)) {
                displayValue = value.map((u: {name?: string; mail?: string}) => `${u.name} (${u.mail})`).join(', ')
              } else if (typeof value === 'object') {
                displayValue = JSON.stringify(value)
              } else {
                displayValue = String(value)
              }
              return (
                <div className="detail-row" key={key}>
                  <span className="detail-label">{label}</span>
                  <span className="detail-value">{displayValue}</span>
                </div>
              )
            })}
          </fieldset>
        )}

        {selectedRequest.resolutionComment && (
          <fieldset>
            <legend>Resolution</legend>
            <div className="detail-row">
              <span className="detail-label">Comment</span>
              <span className="detail-value">{selectedRequest.resolutionComment}</span>
            </div>
          </fieldset>
        )}

        {selectedRequest.tracking && selectedRequest.tracking.length > 0 && (
          <fieldset>
            <legend>Request Tracking</legend>
            {selectedRequest.tracking.map((entry, i) => (
              <div key={i} className="tracking-entry">
                <div className="detail-row">
                  <span className="detail-label">Status</span>
                  <span className="detail-value"><span className={`status-badge status-${entry.status.toLowerCase().replace(/\s/g, '-')}`}>{entry.status}</span></span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">Date</span>
                  <span className="detail-value">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label">By</span>
                  <span className="detail-value">{entry.userName} ({entry.userMail})</span>
                </div>
                {entry.comment && (
                  <div className="detail-row">
                    <span className="detail-label">Comment</span>
                    <span className="detail-value">{entry.comment}</span>
                  </div>
                )}
              </div>
            ))}
          </fieldset>
        )}

        {isAdmin && selectedRequest.status !== 'Resolved' && (
          <fieldset>
            <legend>Actions</legend>
            {selectedRequest.status === 'Open' && (
              <button
                className="submit-btn"
                style={{ marginBottom: '1rem' }}
                onClick={async () => {
                  const res = await fetch(`/api/requests/${selectedRequest.id}/status`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ status: 'In Progress' }),
                  })
                  if (res.ok) {
                    const updated = await res.json()
                    setSelectedRequest(updated)
                    setMyRequests(prev => prev.map(r => r.id === selectedRequest.id ? { ...r, status: 'In Progress' } : r))
                  }
                }}
              >Mark as In Progress</button>
            )}
            <div className="form-field">
              <label>Resolution Comment</label>
              <textarea
                value={resolutionComment}
                onChange={e => setResolutionComment(e.target.value)}
                rows={3}
                style={{ fontFamily: 'Arial, sans-serif' }}
              />
            </div>
            <button
              className="submit-btn"
              disabled={!resolutionComment.trim()}
              onClick={async () => {
                const res = await fetch(`/api/requests/${selectedRequest.id}/status`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ status: 'Resolved', resolutionComment }),
                })
                if (res.ok) {
                  const updated = await res.json()
                  setSelectedRequest(updated)
                  setMyRequests(prev => prev.map(r => r.id === selectedRequest.id ? { ...r, status: 'Resolved' } : r))
                  setResolutionComment('')
                }
              }}
            >Mark as Resolved</button>
          </fieldset>
        )}
      </div>
    )
  }

  const renderForm = () => {
    if (requestType === 'New Data Source in Data Gateway') {
      return (
        <form className="support-form" onSubmit={handleSubmit}>
          <fieldset>
            <legend>Semantic Model Info</legend>
            <div className="form-field">
              <label htmlFor="fabricCapacity">Fabric Capacity</label>
              <select
                id="fabricCapacity"
                value={formData.fabricCapacity}
                onChange={e => {
                  handleInputChange('fabricCapacity', e.target.value)
                  handleInputChange('workspaceName', '')
                }}
                required
              >
                <option value="">Select capacity</option>
                {FABRIC_CAPACITIES.map(cap => (
                  <option key={cap.id} value={cap.id}>
                    {cap.name} ({cap.sku})
                  </option>
                ))}
              </select>
            </div>
            <SearchableSelect
              label="Workspace Name"
              placeholder="Search workspace..."
              value={formData.workspaceName}
              onChange={val => {
                handleInputChange('workspaceName', val)
                handleInputChange('semanticModelName', '')
              }}
              dataUrl="/workspaces.json"
              filterBy={formData.fabricCapacity}
              disabled={!formData.fabricCapacity}
              required
            />
            <SearchableSelect
              label="Semantic Model Name"
              placeholder="Search semantic model..."
              value={formData.semanticModelName}
              onChange={val => handleInputChange('semanticModelName', val)}
              options={semanticModels}
              disabled={!formData.workspaceName || loadingModels}
              required
            />
          </fieldset>

          <fieldset>
            <legend>Data Source Info</legend>
            <div className="form-field">
              <label htmlFor="environment">Environment</label>
              <select
                id="environment"
                value={formData.environment}
                onChange={e => handleInputChange('environment', e.target.value)}
                required
              >
                <option value="">Select environment</option>
                <option value="DEV">DEV</option>
                <option value="PRE">PRE</option>
                <option value="PRO">PRO</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="dataSourceType">Data Source Type</label>
              <select
                id="dataSourceType"
                value={formData.dataSourceType}
                onChange={e => handleInputChange('dataSourceType', e.target.value)}
                required
              >
                <option value="">Select data source type</option>
                <option value="SQL Server">SQL Server</option>
                <option value="Oracle">Oracle</option>
                <option value="SSAS">SSAS</option>
                <option value="Web">Web</option>
                <option value="Folder">Folder</option>
                <option value="Others">Others</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="sourceData">Source Data</label>
              <input
                id="sourceData"
                type="text"
                value={formData.sourceData}
                onChange={e => handleInputChange('sourceData', e.target.value)}
                placeholder={
                  formData.dataSourceType === 'SQL Server' ? 'Servername:port, BBDD, DBLogin' :
                  formData.dataSourceType === 'Oracle' ? 'Servername:port, servicename, DBLogin' :
                  formData.dataSourceType === 'SSAS' ? 'Servername, tabular model name' :
                  formData.dataSourceType === 'Web' ? 'Endpoint url, Login' :
                  formData.dataSourceType === 'Folder' ? 'Path, domain/serviceaccount' : ''
                }
                required
              />
              <span className="field-note">The credentials must be shared with the group CyberArkPBIDATA</span>
            </div>
          </fieldset>

          <fieldset>
            <legend>Users</legend>
            <UserSearch
              label="Users to Share"
              selectedUsers={selectedUsers}
              onChange={setSelectedUsers}
              required
            />
          </fieldset>

          <fieldset>
            <legend>Comments</legend>
            <div className="form-field">
              <textarea
                id="comments"
                value={formData.comments}
                onChange={e => handleInputChange('comments', e.target.value)}
                rows={4}
              />
              <span className="field-note">Add any additional comments or notes</span>
            </div>
          </fieldset>

          <button
            type="submit"
            className="submit-btn"
            disabled={
              !formData.fabricCapacity ||
              !formData.workspaceName ||
              !formData.semanticModelName ||
              !formData.environment ||
              !formData.dataSourceType ||
              !formData.sourceData ||
              selectedUsers.length === 0
            }
          >Submit Request</button>
        </form>
      )
    }

    // Placeholder for other forms
    return (
      <div className="placeholder-form">
        <p>📋 Form for "<strong>{requestType}</strong>" is coming soon.</p>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>POWER MARKETPLACE</h1>
        </header>
        <main className="app-main">
          <div className="success-message">
            <div className="success-icon">✅</div>
            <h2>Request Submitted Successfully</h2>
            <p>Your request for "<strong>{requestType}</strong>" has been sent to the support team.</p>
            <button className="submit-btn" onClick={() => {
              setCategory(null)
              setRequestType(null)
              setSubmitted(false)
              setFormData({
                workspaceName: '',
                fabricCapacity: '',
                semanticModelName: '',
                environment: '',
                dataSourceType: '',
                sourceData: '',
                usersToShare: '',
    comments: '',
              })
              setSelectedUsers([])
            }}>
              New Request
            </button>
            <button className="submit-btn" style={{ background: 'transparent', color: '#1a1a2e', border: '1px solid #1a1a2e' }} onClick={() => {
              setCategory('my-requests')
              setRequestType(null)
              setSubmitted(false)
            }}>
              My Requests
            </button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>POWER MARKETPLACE</h1>
      </header>
      <main className="app-main">
        {renderBreadcrumb()}
        {(category || requestType) && (
          <button className="back-btn" onClick={handleBack}>← Back</button>
        )}
        {!category && renderCategorySelection()}
        {category === 'my-requests' && renderMyRequests()}
        {category && category !== 'my-requests' && !requestType && renderRequestSelection()}
        {requestType && renderForm()}
      </main>
    </div>
  )
}

export default App
