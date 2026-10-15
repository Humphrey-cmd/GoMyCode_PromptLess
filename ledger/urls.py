from django.urls import path
from . import views

urlpatterns = [
    path('',views.home, name = 'home_view'),
    path('register',views.register, name = 'register_view'),
    path('login',views.user_login, name = 'login_view'),
    path('dashboard',views.dashboard, name = 'dashboard'),
    path('js/config.js', views.frontend_config, name = 'frontend-config'),
    path('api/scout/', views.scout, name='scout'),
]