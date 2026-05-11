export function SearchBar({ value, onChange, placeholder = "Search orders..." }) {
  return (
    <div className="search-bar-container">
      <span style={{color: 'white', fontWeight: 'bold', marginRight: '10px'}}>🔍 SEARCH:</span>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="search-input"
      />
      {value && (
        <button
          className="search-clear"
          onClick={() => onChange("")}
          title="Clear search"
        >
          ✕
        </button>
      )}
    </div>
  );
}
