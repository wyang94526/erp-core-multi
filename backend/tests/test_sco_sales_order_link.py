# @author: Wendy Yang
# @date: 2026-09-19

from unittest import TestCase

from app.schemas import SubcontractOrderCreate, SubcontractOrderRead
from app.routers.subcontract_orders import list_subcontract_orders
from inspect import signature


class ScoSalesOrderLinkTests(TestCase):
    def test_create_schema_accepts_parent_sales_order_id(self):
        payload = SubcontractOrderCreate(
            supplier_id="V001",
            item_id="ITEM-1",
            quantity_ordered=2,
            sales_order_id="PU61-26060001",
        )
        self.assertEqual(payload.sales_order_id, "PU61-26060001")

    def test_read_schema_exposes_parent_sales_order_id(self):
        fields = SubcontractOrderRead.model_fields
        self.assertIn("sales_order_id", fields)

    def test_list_endpoint_filters_by_sales_order_id(self):
        params = signature(list_subcontract_orders).parameters
        self.assertIn("sales_order_id", params)
