import assert from "node:assert/strict"
import test from "node:test"
import {
  createEmptyQuoteItem,
  groupQuoteItemsForEditor,
  normalizeQuoteItems
} from "./cateringQuoteTemplates.js"

function firstEditorItem(items) {
  return groupQuoteItemsForEditor(items)[0].lines[0].item
}

test("groupQuoteItemsForEditor preserves trailing spaces in description while editing", () => {
  const items = [{ ...createEmptyQuoteItem(1), description: "Esta " }]
  assert.equal(firstEditorItem(items).description, "Esta ")
})

test("groupQuoteItemsForEditor preserves internal spaces in description while editing", () => {
  const items = [{ ...createEmptyQuoteItem(1), description: "Esta es una prueba" }]
  assert.equal(firstEditorItem(items).description, "Esta es una prueba")
})

test("groupQuoteItemsForEditor preserves leading and trailing spaces in description while editing", () => {
  const items = [{ ...createEmptyQuoteItem(1), description: "  Esta es una prueba  " }]
  assert.equal(firstEditorItem(items).description, "  Esta es una prueba  ")
})

test("groupQuoteItemsForEditor preserves trailing spaces in option_label while editing", () => {
  const items = [{
    ...createEmptyQuoteItem(1),
    description: "Menu",
    line_kind: "option",
    option_group_name: "Plato fuerte",
    option_label: "Res "
  }]
  assert.equal(firstEditorItem(items).option_label, "Res ")
})

test("groupQuoteItemsForEditor preserves trailing spaces in option_group_name while editing", () => {
  const items = [{
    ...createEmptyQuoteItem(1),
    description: "Menu",
    line_kind: "option",
    option_group_name: "Plato fuerte ",
    option_label: "Res"
  }]
  assert.equal(firstEditorItem(items).option_group_name, "Plato fuerte ")
})

test("normalizeQuoteItems still trims text fields at the normalization boundary", () => {
  const [item] = normalizeQuoteItems([{
    ...createEmptyQuoteItem(1),
    description: "  Esta es una prueba  ",
    option_group_name: " Grupo ",
    option_label: " Etiqueta "
  }])

  assert.equal(item.description, "Esta es una prueba")
  assert.equal(item.option_group_name, "Grupo")
  assert.equal(item.option_label, "Etiqueta")
})

test("groupQuoteItemsForEditor keeps normalized numeric defaults while preserving raw text", () => {
  const items = [{
    ...createEmptyQuoteItem(1),
    description: "Esta ",
    quantity: "2",
    unit_price: "15.5"
  }]

  const editorItem = firstEditorItem(items)
  assert.equal(editorItem.description, "Esta ")
  assert.equal(editorItem.quantity, 2)
  assert.equal(editorItem.unit_price, 15.5)
})

test("groupQuoteItemsForEditor keeps section grouping and line indices", () => {
  const items = [
    {
      ...createEmptyQuoteItem(1),
      description: "Linea A ",
      source_template_id: "tpl-1",
      source_template_name: "Banquete",
      section_name: "Banquete",
      section_order: 1
    },
    {
      ...createEmptyQuoteItem(2),
      description: "Linea B",
      source_template_id: "tpl-1",
      source_template_name: "Banquete",
      section_name: "Banquete",
      section_order: 1
    },
    { ...createEmptyQuoteItem(3), description: "Manual " }
  ]

  const groups = groupQuoteItemsForEditor(items)

  assert.equal(groups.length, 2)
  assert.equal(groups[0].type, "template_section")
  assert.equal(groups[0].lines.length, 2)
  assert.deepEqual(groups[0].lines.map((line) => line.index), [0, 1])
  assert.equal(groups[0].lines[0].item.description, "Linea A ")
  assert.equal(groups[0].lines[1].item.description, "Linea B")
  assert.equal(groups[1].type, "manual_line")
  assert.equal(groups[1].lines[0].index, 2)
  assert.equal(groups[1].lines[0].item.description, "Manual ")
})
