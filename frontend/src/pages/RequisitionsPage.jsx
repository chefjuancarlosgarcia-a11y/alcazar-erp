import { useSearchParams } from "react-router-dom"
import RequisitionsSupabase from "./RequisitionsSupabase"
import { parseRequisitionRouteSearchParams } from "../utils/requisitionRouteParams"

export default function RequisitionsPage() {
  const [searchParams] = useSearchParams()
  const requisitionProps = parseRequisitionRouteSearchParams(searchParams)
  return <RequisitionsSupabase {...requisitionProps} />
}
