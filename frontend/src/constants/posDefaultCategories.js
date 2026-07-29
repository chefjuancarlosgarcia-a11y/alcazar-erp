/** Canonical POS category metadata (shared human + station; station never reads localStorage). */
export const DEFAULT_POS_CATEGORIES = [
  { id: "entradas", name: "Entradas", description: "", productionAreaId: "cocina", active: true, sortOrder: 1, color: "#0ea5a4", icon: "🥗" },
  { id: "pizzas", name: "Pizzas", description: "Pizzas de la casa", productionAreaId: "pizzeria", active: true, sortOrder: 2, color: "#f97316", icon: "🍕" },
  { id: "sandwiches", name: "Sándwiches", description: "", productionAreaId: "cocina", active: true, sortOrder: 3, color: "#eab308", icon: "🍔" },
  { id: "postres", name: "Postres", description: "", productionAreaId: "reposteria", active: true, sortOrder: 4, color: "#ec4899", icon: "🍰" },
  { id: "cafeteria", name: "Cafetería", description: "", productionAreaId: "cafeteria", active: true, sortOrder: 5, color: "#14b8a6", icon: "☕" },
  { id: "barra", name: "Barra", description: "", productionAreaId: "barra", active: true, sortOrder: 6, color: "#38bdf8", icon: "🍹" },
  { id: "extras", name: "Extras", description: "", productionAreaId: "cocina", active: true, sortOrder: 7, color: "#a78bfa", icon: "🍟" }
]
