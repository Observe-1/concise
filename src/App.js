import React from "react";
// import '../src/assets/css/App.css';
import AppBarWithSearch from "./components/AppBarWithSearch";
import SearchPage from "./pages/SearchPage";

function App() {
  return (
    <div className="App">
      <AppBarWithSearch />
      <SearchPage />
      <header className="App-header"></header>
    </div>
  );
}

export default App;
