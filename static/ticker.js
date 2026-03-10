(function () {
  const apiBase = window.location.origin;
  const tickerList = document.getElementById("tickerList");
  const tickerListDup = document.getElementById("tickerListDup");

  function renderTickerItems(items) {
    if (!items || !items.length) {
      items = [
        { symbol: "SPX", name: "S&P 500", value: "5,847", change: 0.24 },
        { symbol: "US10Y", name: "10Y", value: "4.28%", change: 0.01 },
        { symbol: "DXY", name: "Dollar", value: "104.82", change: -0.15 },
        { symbol: "XAU", name: "Gold", value: "2,341", change: 0.56 },
        { symbol: "WTI", name: "WTI", value: "78.42", change: -0.34 },
      ];
    }
    function toHtml(list) {
      return items
        .map(function (item) {
          const change = Number(item.change);
          const up = change >= 0;
          const sign = up ? "+" : "";
          const cls = up ? "ticker-item__change--up" : "ticker-item__change--down";
          return (
            '<span class="ticker-item">' +
            '<span class="ticker-item__symbol">' +
            escapeHtml(item.symbol) +
            "</span> " +
            '<span class="ticker-item__value">' +
            escapeHtml(String(item.value)) +
            "</span> " +
            '<span class="ticker-item__change ' +
            cls +
            '">' +
            sign +
            change +
            "%</span>" +
            "</span>"
          );
        })
        .join("");
    }
    function escapeHtml(s) {
      const div = document.createElement("div");
      div.textContent = s;
      return div.innerHTML;
    }
    if (tickerList) tickerList.innerHTML = toHtml(items);
    if (tickerListDup) tickerListDup.innerHTML = toHtml(items);
  }

  function fetchTicker() {
    fetch(apiBase + "/api/ticker")
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.items && data.items.length) {
          renderTickerItems(data.items);
        } else {
          renderTickerItems([]);
        }
      })
      .catch(function () {
        renderTickerItems([]);
      });
  }

  fetchTicker();
  setInterval(fetchTicker, 60000);
})();
