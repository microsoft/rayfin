import { useState, useEffect, useRef } from 'react'

interface User {
  id: string
  displayName: string
  mail: string
}

interface UserSearchProps {
  label: string
  selectedUsers: User[]
  onChange: (users: User[]) => void
  required?: boolean
}

export function UserSearch({ label, selectedUsers, onChange, required }: UserSearchProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<User[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (!query.trim() || query.length < 3) {
      setResults([])
      return
    }

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setLoading(true)
      fetch(`/api/users?q=${encodeURIComponent(query)}`)
        .then(res => res.json())
        .then((data: User[]) => {
          const filtered = data.filter(u => !selectedUsers.some(s => s.id === u.id))
          setResults(filtered)
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false))
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [query, selectedUsers])

  const handleAdd = (user: User) => {
    onChange([...selectedUsers, user])
    setQuery('')
    setResults([])
  }

  const handleRemove = (userId: string) => {
    onChange(selectedUsers.filter(u => u.id !== userId))
  }

  return (
    <div className="form-field user-search" ref={containerRef}>
      <label>{label}</label>
      {selectedUsers.length > 0 && (
        <div className="user-chips">
          {selectedUsers.map(user => (
            <span key={user.id} className="user-chip">
              {user.displayName}
              <button type="button" className="chip-remove" onClick={() => handleRemove(user.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="search-input-wrapper">
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setIsOpen(true) }}
          onFocus={() => setIsOpen(true)}
          placeholder="Search users (min. 3 characters)..."
          autoComplete="off"
          required={required && selectedUsers.length === 0}
        />
        <span className="search-icon">{loading ? '⏳' : '⌕'}</span>
      </div>
      {isOpen && query.length >= 3 && (
        <div className="search-dropdown">
          {loading ? (
            <div className="search-no-results">Searching...</div>
          ) : results.length > 0 ? (
            results.map(user => (
              <div
                key={user.id}
                className="search-option user-option"
                onClick={() => handleAdd(user)}
              >
                <span className="user-name">{user.displayName}</span>
                <span className="user-mail">{user.mail}</span>
              </div>
            ))
          ) : (
            <div className="search-no-results">No users found</div>
          )}
        </div>
      )}
    </div>
  )
}
