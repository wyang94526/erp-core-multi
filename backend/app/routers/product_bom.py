from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Product, ProductBOMComponent
from app.schemas import ProductBOMComponentCreate, ProductBOMComponentRead

router = APIRouter(prefix="/products", tags=["product-bom"])


@router.get("/{product_id}/bom", response_model=list[ProductBOMComponentRead])
def list_bom_components(product_id: str, db: Session = Depends(get_db)) -> list[ProductBOMComponent]:
    """List all BOM components (raw materials) required to build a given finished product."""
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return (
        db.query(ProductBOMComponent)
        .filter(ProductBOMComponent.parent_product_id == product_id)
        .all()
    )


@router.post("/{product_id}/bom", response_model=ProductBOMComponentRead, status_code=status.HTTP_201_CREATED)
def add_bom_component(
    product_id: str, payload: ProductBOMComponentCreate, db: Session = Depends(get_db)
) -> ProductBOMComponent:
    """Add a component/raw-material line to a finished product's Bill of Materials."""
    parent = db.get(Product, product_id)
    if not parent:
        raise HTTPException(status_code=404, detail="Parent product not found")

    if payload.component_product_id == product_id:
        raise HTTPException(status_code=400, detail="A product cannot be a component of itself")

    component = db.get(Product, payload.component_product_id)
    if not component:
        raise HTTPException(status_code=400, detail="Component product not found")

    existing = (
        db.query(ProductBOMComponent)
        .filter(
            ProductBOMComponent.parent_product_id == product_id,
            ProductBOMComponent.component_product_id == payload.component_product_id,
        )
        .first()
    )
    if existing:
        raise HTTPException(status_code=400, detail="This component already exists on the BOM")

    bom_line = ProductBOMComponent(
        parent_product_id=product_id,
        component_product_id=payload.component_product_id,
        quantity_per=payload.quantity_per,
    )
    db.add(bom_line)
    db.commit()
    db.refresh(bom_line)
    return bom_line


@router.delete("/{product_id}/bom/{bom_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bom_component(product_id: str, bom_id: int, db: Session = Depends(get_db)) -> None:
    bom_line = (
        db.query(ProductBOMComponent)
        .filter(
            ProductBOMComponent.bom_id == bom_id,
            ProductBOMComponent.parent_product_id == product_id,
        )
        .first()
    )
    if not bom_line:
        raise HTTPException(status_code=404, detail="BOM component not found")
    db.delete(bom_line)
    db.commit()
