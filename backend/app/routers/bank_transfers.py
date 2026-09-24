# @author: Wendy Yang
# @date: 2026-09-24

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas import BankTransferCreate, BankTransferRead, BankTransferUpdate
from app.services import finance

router = APIRouter(prefix="/bank-transfers", tags=["bank-transfers"])


@router.get("", response_model=list[BankTransferRead])
def list_bank_transfers(db: Session = Depends(get_db)):
    rows = finance.list_bank_transfers(db)
    return [finance.serialize_bank_transfer(row) for row in rows]


@router.get("/{transfer_id}", response_model=BankTransferRead)
def get_bank_transfer(transfer_id: int, db: Session = Depends(get_db)):
    transfer = finance.get_bank_transfer(db, transfer_id)
    return finance.serialize_bank_transfer(transfer)


@router.post("", response_model=BankTransferRead, status_code=status.HTTP_201_CREATED)
def create_bank_transfer(payload: BankTransferCreate, db: Session = Depends(get_db)):
    transfer = finance.create_bank_transfer(
        db,
        from_account_id=payload.from_account_id,
        to_account_id=payload.to_account_id,
        amount=payload.amount,
        transfer_date=payload.transfer_date,
        reference_number=payload.reference_number,
    )
    db.commit()
    transfer = finance.get_bank_transfer(db, transfer.id)
    return finance.serialize_bank_transfer(transfer)


@router.patch("/{transfer_id}", response_model=BankTransferRead)
def update_bank_transfer(transfer_id: int, payload: BankTransferUpdate, db: Session = Depends(get_db)):
    transfer = finance.update_bank_transfer(
        db,
        transfer_id,
        from_account_id=payload.from_account_id,
        to_account_id=payload.to_account_id,
        amount=payload.amount,
        transfer_date=payload.transfer_date,
        reference_number=payload.reference_number,
    )
    db.commit()
    transfer = finance.get_bank_transfer(db, transfer.id)
    return finance.serialize_bank_transfer(transfer)


@router.delete("/{transfer_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bank_transfer(transfer_id: int, db: Session = Depends(get_db)):
    finance.delete_bank_transfer(db, transfer_id)
    db.commit()


@router.post("/{transfer_id}/post", response_model=BankTransferRead)
def post_bank_transfer(transfer_id: int, db: Session = Depends(get_db)):
    transfer = finance.post_bank_transfer(db, transfer_id)
    db.commit()
    transfer = finance.get_bank_transfer(db, transfer.id)
    return finance.serialize_bank_transfer(transfer)
