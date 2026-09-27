from django.urls import path
from . import views

urlpatterns = [
    path('register',views.register, name = 'register_view'),
    path('login',views.user_login, name = 'login_view'),
    path('',views.home, name = 'home_view'),
    path('dashboard',views.dashboard, name = 'dashboard')
]