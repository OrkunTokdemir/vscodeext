cmake_minimum_required(VERSION 3.16)

project(QmlDebugTest VERSION 0.1 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(Qt6 6.4 REQUIRED COMPONENTS Quick)

qt_standard_project_setup()

qt_add_executable(appQmlDebugTest
    main.cpp
)

qt_add_qml_module(appQmlDebugTest
    URI QmlDebugTest
    VERSION 1.0
    QML_FILES Main.qml
)

target_link_libraries(appQmlDebugTest
    PRIVATE Qt6::Quick
)

install(TARGETS appQmlDebugTest
    BUNDLE DESTINATION .
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)
