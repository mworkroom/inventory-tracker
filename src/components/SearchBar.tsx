import { CloseIcon, SearchIcon } from "./Icons";

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <label className="search-wrap">
      <SearchIcon className="search-icon" />
      <span className="sr-only">제품 검색</span>
      <input
        type="search"
        value={value}
        placeholder="제품명이나 메모로 검색"
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
      />
      {value ? (
        <button type="button" className="search-clear" aria-label="검색어 지우기" onClick={() => onChange("")}>
          <CloseIcon />
        </button>
      ) : null}
    </label>
  );
}
