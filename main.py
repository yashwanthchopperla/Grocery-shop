import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from bson import ObjectId

# Load environment variables
load_dotenv()
MONGO_URI = os.getenv("MONGO_URI")

# MongoDB client
client = None
db = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global client, db
    client = AsyncIOMotorClient(MONGO_URI)
    db = client.kirana_shop
    print("Connected to MongoDB")
    yield
    client.close()
    print("Disconnected from MongoDB")

app = FastAPI(lifespan=lifespan)

# --- MODELS ---
# Helper to convert MongoDB ObjectId to string
class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, *args, **kwargs):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid objectid")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, core_schema, handler):
        schema = handler(core_schema)
        schema.update(type="string")
        return schema

class ProductModel(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    name: str
    price: float
    unit: str
    category: str = "Other"

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

class BillItemModel(BaseModel):
    productId: str
    name: str
    qty: float
    unit: str
    price: float

class BillModel(BaseModel):
    id: Optional[PyObjectId] = Field(alias="_id", default=None)
    billNo: int
    customer: Optional[str] = ""
    phone: Optional[str] = ""
    items: List[BillItemModel]
    grandTotal: float
    timestamp: datetime = Field(default_factory=datetime.utcnow)

    class Config:
        populate_by_name = True
        json_encoders = {ObjectId: str}

# --- API ENDPOINTS ---

@app.get("/api/products", response_model=List[ProductModel])
async def get_products():
    products = await db.products.find().to_list(1000)
    return products

@app.post("/api/products", response_model=ProductModel)
async def create_product(product: ProductModel):
    product_dict = product.model_dump(by_alias=True, exclude={"id"})
    result = await db.products.insert_one(product_dict)
    created_product = await db.products.find_one({"_id": result.inserted_id})
    return created_product

@app.put("/api/products/{id}", response_model=ProductModel)
async def update_product(id: str, product: ProductModel):
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    update_data = product.model_dump(by_alias=True, exclude={"id"})
    result = await db.products.update_one({"_id": ObjectId(id)}, {"$set": update_data})
    if result.modified_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    updated_product = await db.products.find_one({"_id": ObjectId(id)})
    return updated_product

@app.delete("/api/products/{id}")
async def delete_product(id: str):
    if not ObjectId.is_valid(id):
        raise HTTPException(status_code=400, detail="Invalid ID")
    result = await db.products.delete_one({"_id": ObjectId(id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Product not found")
    return {"message": "Product deleted successfully"}

@app.get("/api/bills", response_model=List[BillModel])
async def get_bills():
    bills = await db.bills.find().to_list(1000)
    return bills

@app.post("/api/bills", response_model=BillModel)
async def create_bill(bill: BillModel):
    bill_dict = bill.model_dump(by_alias=True, exclude={"id"})
    result = await db.bills.insert_one(bill_dict)
    created_bill = await db.bills.find_one({"_id": result.inserted_id})
    return created_bill

# --- STATIC FILES ---
# Mount the current directory to serve static files
app.mount("/static", StaticFiles(directory=".", html=False), name="static")

@app.get("/")
async def serve_index():
    return FileResponse("index.html")

@app.get("/{filename}")
async def serve_file(filename: str):
    if os.path.isfile(filename):
        return FileResponse(filename)
    raise HTTPException(status_code=404, detail="File not found")
