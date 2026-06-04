import { useState, useEffect, useRef } from 'react'

interface Option {
  id: string
  name: string
  capacityId?: string
}

interface SearchableSelectProps {
  label: string
  placeholder?: string
  value: string
  onChange: (value: string) => void
  dataUrl?: string
  options?: Option[]
  filterBy?: string
  disabled?: boolean
  required?: boolean
}

export function SearchableSelect({
  label,
  placeholder = 'Search',
  value,
  onChange,
  dataUrl,
  options: externalOptions,
  filterBy,
  disabled,
  required,
}: SearchableSelectProps) {
  const [options, setOptions] = useState<Option[]>([])
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [filtered, setFiltered] = useState<Option[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (externalOptions) {
      setOptions(externalOptions)
      return
    }
    if (!dataUrl) return
    setLoading(true)
    fetch(dataUrl)
      .then(res => res.json())
      .then((data: Option[]) => setOptions(data))
      .catch(() => setOptions([]))
      .finally(() => setLoading(false))
  }, [dataUrl, externalOptions])

  useEffect(() => {
    let pool = options
    if (filterBy) {
      pool = pool.filter(o => o.capacityId === filterBy)
    }
    if (!query.trim()) {
      setFiltered(pool.slice(0, 50))
      return
    }
    const lower = query.toLowerCase()
    const results = pool.filter(o => o.name.toLowerCase().includes(lower))
    setFiltered(results.slice(0, 50))
  }, [query, options, filterBy])

  useEffect(() => {
    if (value && options.length > 0) {
      const match = options.find(o => o.id === value)
      if (match) setQuery(match.name)
    }
    if (!value) setQuery('')
  }, [value, options])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (option: Option) => {
    setQuery(option.name)
    onChange(option.id)
    setIsOpen(false)
  }

  const handleInputChange = (val: string) => {
    setQuery(val)
    setIsOpen(true)
    if (!val.trim()) {
      onChange('')
    }
  }

  return (
    <div className={`form-field searchable-select ${disabled ? 'disabled' : ''}`} ref={containerRef}>
      <label>{label}</label>
      <div className="search-input-wrapper">
        <input
          type="text"
          value={query}
          onChange={e => handleInputChange(e.target.value)}
          onFocus={() => setIsOpen(true)}
          placeholder={disabled ? 'Select previous field first' : placeholder}
          required={required}
          autoComplete="off"
          disabled={disabled}
        />
        <span className="search-icon">{loading ? '\u23F3' : '\u2315'}</span>
      </div>
      {isOpen && !disabled && (
        <div className="search-dropdown">
          {loading ? (
            <div className="search-no-results">Loading...</div>
          ) : filtered.length > 0 ? (
            filtered.map(opt => (
              <div
                key={opt.id}
                className="search-option"
                onClick={() => handleSelect(opt)}
              >
                {opt.name}
              </div>
            ))
          ) : (
            <div className="search-no-results">No results found</div>
          )}
        </div>
      )}
    </div>
  )
}
