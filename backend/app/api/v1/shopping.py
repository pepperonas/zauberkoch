"""Shopping list: aggregate ingredients across recipes, check, reorder."""

import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DbSession

from app.core.security import get_current_user, require_csrf
from app.db import get_db
from app.models import Recipe, ShoppingListItem, User
from app.services.aggregation import format_amount, normalize, scale

router = APIRouter(prefix="/shopping")

MAX_ITEMS = 300


def _items(db: DbSession, user: User) -> list[ShoppingListItem]:
    return list(
        db.execute(
            select(ShoppingListItem)
            .where(ShoppingListItem.user_id == user.id)
            .order_by(ShoppingListItem.position, ShoppingListItem.id)
        ).scalars()
    )


def _serialize(item: ShoppingListItem) -> dict:
    menge, einheit = (None, item.einheit)
    if item.menge is not None:
        menge, einheit = format_amount(item.menge, item.einheit)
    return {
        "id": item.id,
        "name": item.name,
        "menge": menge,
        "einheit": einheit,
        "checked": item.checked,
        "position": item.position,
    }


@router.get("")
def list_items(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    return {"items": [_serialize(i) for i in _items(db, user)]}


class FromRecipeBody(BaseModel):
    recipe_id: int
    portionen: int | None = Field(default=None, ge=1, le=24)  # scale target, default recipe portions


def merge_recipe_into_list(db: DbSession, user: User, row: Recipe, portionen: int | None = None) -> None:
    """Aggregate a recipe's ingredients into the list (shared with the planner)."""
    recipe = json.loads(row.recipe_json)
    base_portionen = max(int(recipe.get("portionen") or 1), 1)
    factor = (portionen or base_portionen) / base_portionen

    existing = _items(db, user)
    # merge target: same normalized name + same base unit, not yet checked
    index: dict[tuple[str, str], ShoppingListItem] = {
        (i.name.lower(), i.einheit): i for i in existing if not i.checked
    }
    total = len(existing)
    next_pos = max((i.position for i in existing), default=-1) + 1

    for zutat in recipe.get("zutaten", []):
        norm = normalize(zutat.get("name", ""), scale(zutat.get("menge"), factor), zutat.get("einheit", ""))
        if not norm.name:
            continue
        key = (norm.name_key, norm.einheit)
        target = index.get(key)
        if target is not None and norm.menge is not None and target.menge is not None:
            target.menge += norm.menge
        elif target is not None and norm.menge is None:
            pass  # already on the list, nothing to add
        else:
            if total >= MAX_ITEMS:
                raise HTTPException(
                    status_code=422,
                    detail={"code": "list_full", "message": "Die Einkaufsliste ist voll."},
                )
            total += 1
            item = ShoppingListItem(
                user_id=user.id,
                name=norm.name,
                menge=norm.menge,
                einheit=norm.einheit,
                position=next_pos,
                recipe_id=row.id,
            )
            next_pos += 1
            db.add(item)
            index[key] = item
    db.commit()


@router.post("/from-recipe", dependencies=[Depends(require_csrf)])
def add_from_recipe(
    body: FromRecipeBody,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    row = db.get(Recipe, body.recipe_id)
    if row is None or row.user_id != user.id or row.deleted_at is not None:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Rezept nicht gefunden."})
    merge_recipe_into_list(db, user, row, body.portionen)
    return {"items": [_serialize(i) for i in _items(db, user)]}


class ManualItemBody(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    menge: float | None = Field(default=None, ge=0)
    einheit: str = Field(default="", max_length=32)


@router.post("/items", dependencies=[Depends(require_csrf)])
def add_item(
    body: ManualItemBody,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    norm = normalize(body.name, body.menge, body.einheit)
    existing = _items(db, user)
    # Same merge rule as adding from a recipe: (normalized name, base unit) on
    # an unchecked line. Without this, typing "Tomate" twice left two identical
    # lines on the list — the recipe path has always merged, the manual one
    # never did.
    target = next(
        (i for i in existing if not i.checked and (i.name.lower(), i.einheit) == (norm.name_key, norm.einheit)),
        None,
    )
    if target is not None:
        if norm.menge is not None:
            target.menge = (target.menge or 0) + norm.menge
        db.commit()
        return _serialize(target)

    next_pos = max((i.position for i in existing), default=-1) + 1
    item = ShoppingListItem(
        user_id=user.id, name=norm.name, menge=norm.menge, einheit=norm.einheit, position=next_pos
    )
    db.add(item)
    db.commit()
    return _serialize(item)


class PatchItemBody(BaseModel):
    checked: bool | None = None


@router.patch("/items/{item_id}", dependencies=[Depends(require_csrf)])
def patch_item(
    item_id: int,
    body: PatchItemBody,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    item = db.get(ShoppingListItem, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Eintrag nicht gefunden."})
    if body.checked is not None:
        item.checked = body.checked
    db.commit()
    return _serialize(item)


@router.delete("/items/{item_id}", dependencies=[Depends(require_csrf)])
def delete_item(
    item_id: int,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    item = db.get(ShoppingListItem, item_id)
    if item is None or item.user_id != user.id:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Eintrag nicht gefunden."})
    db.delete(item)
    db.commit()
    return {"deleted": True}


class ReorderBody(BaseModel):
    ids: list[int] = Field(max_length=MAX_ITEMS)


@router.post("/reorder", dependencies=[Depends(require_csrf)])
def reorder(
    body: ReorderBody,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    items = {i.id: i for i in _items(db, user)}
    pos = 0
    for item_id in body.ids:
        item = items.get(item_id)
        if item is not None:
            item.position = pos
            pos += 1
    db.commit()
    return {"items": [_serialize(i) for i in _items(db, user)]}


@router.delete("/checked", dependencies=[Depends(require_csrf)])
def clear_checked(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    for item in _items(db, user):
        if item.checked:
            db.delete(item)
    db.commit()
    return {"items": [_serialize(i) for i in _items(db, user)]}


@router.delete("", dependencies=[Depends(require_csrf)])
def clear_all(user: User = Depends(get_current_user), db: DbSession = Depends(get_db)) -> dict:
    for item in _items(db, user):
        db.delete(item)
    db.commit()
    return {"items": []}


class ReplaceItem(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    menge: float | None = Field(default=None, ge=0)
    einheit: str = Field(default="", max_length=32)
    checked: bool = False


class ReplaceBody(BaseModel):
    items: list[ReplaceItem] = Field(max_length=MAX_ITEMS)


@router.post("/replace", dependencies=[Depends(require_csrf)])
def replace_all(
    body: ReplaceBody,
    user: User = Depends(get_current_user),
    db: DbSession = Depends(get_db),
) -> dict:
    """Replace the whole list — generic undo-restore for destructive operations."""
    for item in _items(db, user):
        db.delete(item)
    for position, entry in enumerate(body.items):
        norm = normalize(entry.name, entry.menge, entry.einheit)  # kg->g etc., keeps merges consistent
        db.add(
            ShoppingListItem(
                user_id=user.id,
                name=norm.name,
                menge=norm.menge,
                einheit=norm.einheit,
                checked=entry.checked,
                position=position,
            )
        )
    db.commit()
    return {"items": [_serialize(i) for i in _items(db, user)]}
